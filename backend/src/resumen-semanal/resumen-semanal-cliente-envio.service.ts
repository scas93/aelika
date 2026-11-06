import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CorreoProvider } from '../notificaciones/providers/correo.provider';
import { normalizarCorreo } from '../notificaciones/notificacion-correo-resumen';
import { fechaDeSemana } from '../notificaciones-reglas/recordatorio-semanal';
import { ResumenSemanalArmadoService } from './resumen-semanal-armado.service';
import { motivoSeguro } from './resumen-semanal-envio.service';
import type { SemanaResumen } from './resumen-semanal';

const PRISMA_UNIQUE = 'P2002';
/** Reintentos ante un rechazo por exceso de tasa de Resend (429), con espera creciente (o la que pida Resend). */
const MAX_REINTENTOS_TASA = 4;
const ESPERA_BASE_MS = 1000;
const ESPERA_MAX_MS = 20000;

export interface ClienteParaResumen {
  id: string;
  tenantId: string;
  nombre: string;
  /** Correo propio del resumen (Cliente.resumenSemanalCorreo), nunca Cliente.correo. */
  correoResumen: string;
}
export interface NegocioParaResumen {
  nombre: string;
  /** Reply-To (Tenant.correoRespuestas); sin él, el correo sale sin Reply-To. */
  correoRespuestas: string | null;
}

export type ResultadoEnvioCliente =
  | { resultado: 'EXITO' | 'FALLO'; motivo?: string }
  | { resultado: 'DUPLICADO' }
  /** Nada que mandar (sin pedidos esa semana): no se registra. */
  | { resultado: 'OMITIDO' }
  /** Resend siguió limitando tras los reintentos: no se registra, se intenta de nuevo en la siguiente ejecución del mismo lunes. */
  | { resultado: 'DIFERIDO'; motivo: string };

/**
 * Envío del resumen semanal de UN cliente B2B. PROGRAMADO: crea primero su marca (cliente, semana) y el índice único es la
 * reserva; quien pierde la carrera no envía nada. Solo registra EXITO/FALLO: los omitidos no dejan rastro y un 429 persistente
 * suelta la reserva para reintentar en la siguiente ejecución dentro del mismo lunes (no se pierde el correo). Nunca lanza por
 * un fallo de armado o de envío. Los logs nunca llevan direcciones.
 */
@Injectable()
export class ResumenSemanalClienteEnvioService {
  private readonly logger = new Logger(ResumenSemanalClienteEnvioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly armado: ResumenSemanalArmadoService,
    private readonly correo: CorreoProvider,
  ) {}

  async enviarProgramado(
    cliente: ClienteParaResumen,
    negocio: NegocioParaResumen,
    semana: SemanaResumen,
  ): Promise<ResultadoEnvioCliente> {
    let marcaId: string;
    try {
      const fila = await this.prisma.resumenSemanalClienteEnvio.create({
        data: {
          tenantId: cliente.tenantId,
          clienteId: cliente.id,
          semanaInicio: fechaDeSemana(semana.inicio),
        },
        select: { id: true },
      });
      marcaId = fila.id;
    } catch (error: unknown) {
      if ((error as { code?: string } | null)?.code === PRISMA_UNIQUE)
        return { resultado: 'DUPLICADO' };
      throw error;
    }

    let resultado: 'EXITO' | 'FALLO' = 'FALLO';
    let motivo: string | undefined;
    try {
      const r = await this.armarYEnviar(cliente, negocio, semana, cliente.correoResumen);
      if (r.estado === 'SIN_PEDIDOS' || r.estado === 'DIFERIDO') {
        await this.prisma.resumenSemanalClienteEnvio.delete({
          where: { id: marcaId },
        });
        return r.estado === 'SIN_PEDIDOS'
          ? { resultado: 'OMITIDO' }
          : { resultado: 'DIFERIDO', motivo: r.motivo };
      }
      if (r.estado === 'EXITO') resultado = 'EXITO';
      else motivo = r.motivo;
    } catch (error: unknown) {
      motivo = motivoSeguro(error);
    }
    await this.prisma.resumenSemanalClienteEnvio.update({
      where: { id: marcaId },
      data: {
        estado: resultado,
        motivo: resultado === 'FALLO' ? motivo : null,
        resueltoAt: new Date(),
      },
    });
    this.logger.log(
      `Resumen semanal a cliente (tenant=${cliente.tenantId}, cliente=${cliente.id}, semana=${semana.inicio}): ${resultado}${motivo ? ` — ${motivo}` : ''}`,
    );
    return resultado === 'EXITO'
      ? { resultado }
      : { resultado, motivo };
  }

  /**
   * Botón de prueba: el MISMO correo y Excel que recibiría el cliente, pero a la dirección que escribe el Dueño. No crea marca ni
   * consume el envío del lunes. `null` = el cliente no tuvo pedidos esa semana.
   */
  async enviarPrueba(
    cliente: Omit<ClienteParaResumen, 'correoResumen'>,
    negocio: NegocioParaResumen,
    semana: SemanaResumen,
    destino: string,
  ): Promise<
    | { resultado: 'EXITO' | 'FALLO'; motivo?: string }
    | { resultado: 'SIN_PEDIDOS' }
  > {
    const direccion = normalizarCorreo(destino);
    try {
      const r = await this.armarYEnviar(cliente, negocio, semana, direccion);
      if (r.estado === 'SIN_PEDIDOS') return { resultado: 'SIN_PEDIDOS' };
      if (r.estado === 'EXITO') return { resultado: 'EXITO' };
      return { resultado: 'FALLO', motivo: r.motivo };
    } catch (error: unknown) {
      return { resultado: 'FALLO', motivo: motivoSeguro(error) };
    }
  }

  private async armarYEnviar(
    cliente: Omit<ClienteParaResumen, 'correoResumen'>,
    negocio: NegocioParaResumen,
    semana: SemanaResumen,
    destino: string,
  ): Promise<
    | { estado: 'EXITO' }
    | { estado: 'FALLO' | 'DIFERIDO'; motivo: string }
    | { estado: 'SIN_PEDIDOS' }
  > {
    const armado = await this.armado.armarParaCliente(
      cliente.tenantId,
      cliente.id,
      cliente.nombre,
      negocio.nombre,
      semana,
    );
    if (!armado) return { estado: 'SIN_PEDIDOS' };
    for (let intento = 0; ; intento++) {
      const envio = await this.correo.enviarConAdjuntos({
        destinatarios: [destino],
        // El remitente visible es el nombre del negocio; la dirección de envío sigue siendo RESEND_FROM_ADDRESS.
        nombreRemitente: negocio.nombre,
        mensaje: armado.correo,
        adjuntos: armado.adjunto ? [armado.adjunto] : undefined,
        replyTo: negocio.correoRespuestas ?? undefined,
      });
      if (envio.exito) return { estado: 'EXITO' };
      const motivo = motivoSeguro(envio.error);
      if (!envio.limitadoPorTasa) return { estado: 'FALLO', motivo };
      if (intento >= MAX_REINTENTOS_TASA)
        return { estado: 'DIFERIDO', motivo };
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
