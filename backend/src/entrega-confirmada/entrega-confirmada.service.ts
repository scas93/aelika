import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CorreoProvider } from '../notificaciones/providers/correo.provider';
import { normalizarCorreo } from '../notificaciones/notificacion-correo-resumen';
import { motivoSeguro } from '../resumen-semanal/resumen-semanal-envio.service';
import {
  construirCorreoEntregaConfirmada,
  datosEntregaConfirmada,
} from './entrega-confirmada';

const PRISMA_UNIQUE = 'P2002';
/** Reintentos ante un rechazo por exceso de tasa de Resend (429), con espera creciente (o la que pida Resend). */
const MAX_REINTENTOS_TASA = 4;
const ESPERA_BASE_MS = 1000;
const ESPERA_MAX_MS = 20000;
/** Pausa entre un correo y el siguiente (Resend limita las peticiones por segundo): al marcar varias entregas a la vez salen en fila. */
const PAUSA_ENTRE_ENVIOS_MS = 600;

export type ResultadoAvisoEntrega =
  /** No es una entrega B2B entregada (o no existe): no se registra nada. */
  | { resultado: 'NO_APLICA' }
  /** Ya se había registrado el paso a Entregada de esta entrega: nunca se reenvía. */
  | { resultado: 'DUPLICADO' }
  | { resultado: 'OMITIDO'; motivo: string }
  | { resultado: 'EXITO' }
  | { resultado: 'FALLO'; motivo: string };

const SELECT_PEDIDO = {
  total: true,
  descuentoTotal: true,
  detalleB2b: { select: { descuentoPorcentajeAplicado: true } },
  entregas: {
    select: {
      id: true,
      estado: true,
      fecha: true,
      items: {
        select: {
          cantidad: true,
          orderItem: { select: { precioUnitario: true, nombreProducto: true } },
        },
      },
    },
  },
} as const;

/**
 * «Entrega confirmada»: correo al cliente B2B cuando una entrega pasa a Entregada. Se dispara DESPUÉS del commit del cambio de
 * estatus y en segundo plano (`avisarSeguro` nunca lanza): un fallo de correo jamás impide ni revierte el cambio.
 *
 * Registro (`entrega_confirmada_envios`, único por entrega): la fila se crea ANTES de enviar y es la reserva — desmarcar y volver a
 * marcar, dos peticiones simultáneas o un reinicio no reenvían nunca. Termina en EXITO, FALLO (con motivo, sin direcciones) u
 * OMITIDO (esa primera vez no había nada que enviar: interruptor general o del cliente apagado, o sin correo). Los envíos salen en
 * fila, a ritmo controlado, para no chocar con el límite de Resend cuando se marcan varias entregas a la vez. Los logs nunca llevan
 * direcciones.
 */
@Injectable()
export class EntregaConfirmadaService {
  private readonly logger = new Logger(EntregaConfirmadaService.name);
  private cola: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly correo: CorreoProvider,
  ) {}

  /** Punto de entrada del disparo: encola el aviso y NUNCA lanza ni rechaza. */
  avisarSeguro(tenantId: string, entregaId: string): Promise<void> {
    const tarea = this.cola.then(async () => {
      try {
        const r = await this.avisar(tenantId, entregaId);
        if (r.resultado === 'EXITO' || r.resultado === 'FALLO')
          await this.esperar(PAUSA_ENTRE_ENVIOS_MS);
      } catch (error: unknown) {
        this.logger.error(
          `Entrega confirmada (tenant=${tenantId}, entrega=${entregaId}): ${motivoSeguro(error)}`,
        );
      }
    });
    this.cola = tarea;
    return tarea;
  }

  async avisar(
    tenantId: string,
    entregaId: string,
  ): Promise<ResultadoAvisoEntrega> {
    const entrega = await this.prisma.entrega.findFirst({
      where: { id: entregaId, tenantId },
      select: {
        estado: true,
        orderId: true,
        order: { select: { tipo: true, clienteId: true } },
      },
    });
    if (
      !entrega ||
      entrega.estado !== 'ENTREGADA' ||
      entrega.order.tipo !== 'B2B' ||
      !entrega.order.clienteId
    )
      return { resultado: 'NO_APLICA' };
    const clienteId = entrega.order.clienteId;

    let marcaId: string;
    try {
      const fila = await this.prisma.entregaConfirmadaEnvio.create({
        data: { tenantId, entregaId, clienteId },
        select: { id: true },
      });
      marcaId = fila.id;
    } catch (error: unknown) {
      if ((error as { code?: string } | null)?.code === PRISMA_UNIQUE)
        return { resultado: 'DUPLICADO' };
      throw error;
    }

    let r: ResultadoAvisoEntrega;
    try {
      r = await this.resolver(tenantId, clienteId, entrega.orderId, entregaId);
    } catch (error: unknown) {
      r = { resultado: 'FALLO', motivo: motivoSeguro(error) };
    }
    try {
      await this.prisma.entregaConfirmadaEnvio.update({
        where: { id: marcaId },
        data: {
          estado: r.resultado === 'NO_APLICA' || r.resultado === 'DUPLICADO' ? 'OMITIDO' : r.resultado,
          motivo: 'motivo' in r ? r.motivo : null,
          resueltoAt: new Date(),
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Entrega confirmada: no se pudo registrar el resultado (tenant=${tenantId}, entrega=${entregaId}): ${motivoSeguro(error)}`,
      );
    }
    this.logger.log(
      `Entrega confirmada (tenant=${tenantId}, cliente=${clienteId}, entrega=${entregaId}): ${r.resultado}${'motivo' in r ? ` — ${r.motivo}` : ''}`,
    );
    return r;
  }

  /** Decide si corresponde enviar (interruptores y correo) y, si sí, arma y envía. */
  private async resolver(
    tenantId: string,
    clienteId: string,
    orderId: string,
    entregaId: string,
  ): Promise<ResultadoAvisoEntrega> {
    const [tenant, general, cliente] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { nombre: true, tipoStorefront: true, correoRespuestas: true },
      }),
      this.prisma.notificacionEventoConfig.findFirst({
        where: {
          tenantId,
          evento: 'ENTREGA_CONFIRMADA',
          audiencia: 'CLIENTE',
          activo: true,
        },
        select: { id: true },
      }),
      this.prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: {
          nombre: true,
          entregaConfirmadaActivo: true,
          resumenSemanalCorreo: true,
        },
      }),
    ]);
    if (tenant.tipoStorefront !== 'RETAIL_B2B')
      return { resultado: 'OMITIDO', motivo: 'El negocio no es de mayoreo' };
    if (!general)
      return { resultado: 'OMITIDO', motivo: 'Aviso general apagado' };
    if (!cliente) return { resultado: 'OMITIDO', motivo: 'Cliente no encontrado' };
    if (!cliente.entregaConfirmadaActivo)
      return { resultado: 'OMITIDO', motivo: 'Aviso del cliente apagado' };
    if (!cliente.resumenSemanalCorreo)
      return { resultado: 'OMITIDO', motivo: 'Cliente sin correo' };

    const armado = await this.armar(
      tenantId,
      orderId,
      entregaId,
      tenant.nombre,
      cliente.nombre,
    );
    if (!armado)
      return { resultado: 'OMITIDO', motivo: 'La entrega no tiene productos' };
    const envio = await this.enviarCorreo(
      cliente.resumenSemanalCorreo,
      tenant,
      armado,
    );
    return envio.exito
      ? { resultado: 'EXITO' }
      : { resultado: 'FALLO', motivo: envio.motivo };
  }

  private async armar(
    tenantId: string,
    orderId: string,
    entregaId: string,
    negocioNombre: string,
    clienteNombre: string,
  ) {
    const pedido = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: SELECT_PEDIDO,
    });
    if (!pedido) return null;
    const datos = datosEntregaConfirmada(pedido, entregaId);
    return datos
      ? construirCorreoEntregaConfirmada(negocioNombre, clienteNombre, datos)
      : null;
  }

  /**
   * Botón de prueba: el MISMO correo que recibiría el cliente (con su entrega entregada más reciente), a la dirección que escribe
   * el Dueño. Funciona con los interruptores apagados, no crea registro y no consume nada. `SIN_ENTREGAS` = el cliente aún no tiene
   * una entrega entregada.
   */
  async enviarPrueba(
    tenantId: string,
    cliente: { id: string; nombre: string },
    negocio: { nombre: string; correoRespuestas: string | null },
    destino: string,
  ): Promise<
    | { resultado: 'EXITO' | 'FALLO'; motivo?: string; fechaEntrega: string }
    | { resultado: 'SIN_ENTREGAS' }
  > {
    const direccion = normalizarCorreo(destino);
    const entrega = await this.prisma.entrega.findFirst({
      where: {
        tenantId,
        estado: 'ENTREGADA',
        order: { clienteId: cliente.id, tipo: 'B2B', cancelado: false },
      },
      orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, orderId: true, fecha: true },
    });
    if (!entrega) return { resultado: 'SIN_ENTREGAS' };
    const fechaEntrega = entrega.fecha.toISOString().slice(0, 10);
    try {
      const armado = await this.armar(
        tenantId,
        entrega.orderId,
        entrega.id,
        negocio.nombre,
        cliente.nombre,
      );
      if (!armado) return { resultado: 'SIN_ENTREGAS' };
      const envio = await this.enviarCorreo(direccion, negocio, armado);
      return envio.exito
        ? { resultado: 'EXITO', fechaEntrega }
        : { resultado: 'FALLO', motivo: envio.motivo, fechaEntrega };
    } catch (error: unknown) {
      return { resultado: 'FALLO', motivo: motivoSeguro(error), fechaEntrega };
    }
  }

  private async enviarCorreo(
    destino: string,
    negocio: { nombre: string; correoRespuestas: string | null },
    mensaje: { asunto: string; texto: string; html: string },
  ): Promise<{ exito: true } | { exito: false; motivo: string }> {
    for (let intento = 0; ; intento++) {
      const envio = await this.correo.enviarConAdjuntos({
        destinatarios: [destino],
        // El remitente visible es el nombre del negocio; la dirección de envío sigue siendo RESEND_FROM_ADDRESS.
        nombreRemitente: negocio.nombre,
        mensaje,
        replyTo: negocio.correoRespuestas ?? undefined,
      });
      if (envio.exito) return { exito: true };
      const motivo = motivoSeguro(envio.error);
      if (!envio.limitadoPorTasa || intento >= MAX_REINTENTOS_TASA)
        return { exito: false, motivo };
      const espera = envio.reintentarEnSeg
        ? envio.reintentarEnSeg * 1000
        : ESPERA_BASE_MS * 2 ** intento;
      await this.esperar(Math.min(espera, ESPERA_MAX_MS));
    }
  }

  /** Aparte para poder sustituirla en las pruebas (sin esperas reales). */
  protected esperar(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }
}
