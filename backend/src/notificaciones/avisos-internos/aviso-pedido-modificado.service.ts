import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionEvento, TipoStorefront } from '../../../generated/prisma/enums';
import { AvisoWebhookClient } from './aviso-webhook.client';
import { construirPayloadAviso, ultimos4 } from './aviso-pedido-modificado';
import type { DestinatarioWhatsapp } from '../notificacion-whatsapp';

/** Envíos simultáneos al webhook por aviso (acotado: 10 destinatarios como máximo, 10 s cada uno en el peor caso). */
export const CONCURRENCIA_AVISOS = 4;

/**
 * Aviso interno por WhatsApp cuando un cliente B2B modifica su pedido desde el portal (Cambio C). En proceso, sin cola, después
 * del commit y sin esperar: `avisarSeguro` devuelve de inmediato y NUNCA lanza ni afecta a quien lo llama. Si el proceso muere
 * antes de enviar, el aviso se pierde (aceptado). `FALLO` es definitivo, sin reintentos.
 *
 * Privacidad: el teléfono completo solo viaja en el POST a Botpress; en la tabla y en los logs solo existen los últimos 4
 * dígitos. Los errores de red se loguean por tipo, sin mensaje ni URL del webhook.
 */
@Injectable()
export class AvisoPedidoModificadoService {
  private readonly logger = new Logger(AvisoPedidoModificadoService.name);
  private readonly pendientes = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: AvisoWebhookClient,
  ) {}

  /** Lanza el aviso en segundo plano. Seguro: cualquier error se traga (con log sin datos personales). */
  avisarSeguro(params: { tenantId: string; orderId: string }): void {
    const tarea: Promise<void> = this.avisar(params)
      .catch((error: unknown) => {
        this.logger.error(`Aviso interno de pedido modificado falló antes de enviar (tenant=${params.tenantId}, tipo=${tipoDeError(error)})`);
      })
      .finally(() => {
        this.pendientes.delete(tarea);
      });
    this.pendientes.add(tarea);
  }

  /** Espera los avisos en vuelo. Solo para pruebas y apagado ordenado. */
  async esperarPendientes(): Promise<void> {
    while (this.pendientes.size > 0) await Promise.all([...this.pendientes]);
  }

  private async avisar({ tenantId, orderId }: { tenantId: string; orderId: string }): Promise<void> {
    const omitir = (motivo: string) => this.logger.log(`Aviso interno omitido (tenant=${tenantId}): ${motivo}`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, tipoStorefront: true, botWebhookUrl: true, botWebhookSecret: true },
    });
    if (!tenant || tenant.tipoStorefront !== TipoStorefront.RETAIL_B2B) return omitir('el negocio no es de mayoreo');

    const configEvento = await this.prisma.notificacionEventoConfig.findFirst({
      where: {
        tenantId,
        evento: NotificacionEvento.PEDIDO_MODIFICADO_CLIENTE,
        audiencia: 'NEGOCIO',
        activo: true,
        canalConfig: { tipo: 'WHATSAPP', activo: true },
      },
      include: { canalConfig: true },
    });
    if (!configEvento) return omitir('el evento o el canal de WhatsApp no están activos');

    const destinatarios = leerDestinatarios(configEvento.canalConfig.config);
    if (destinatarios.length === 0) return omitir('el canal no tiene destinatarios');

    const url = tenant.botWebhookUrl?.trim();
    if (!url) return omitir('el negocio no tiene URL de webhook');

    const orden = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, tipo: 'B2B' },
      select: { id: true, folio: true, detalleB2b: { select: { negocioNombre: true, semanaInicio: true } } },
    });
    if (!orden?.detalleB2b) return omitir('el pedido no existe o no tiene detalle');
    const { negocioNombre, semanaInicio } = orden.detalleB2b;

    const enviar = async (d: DestinatarioWhatsapp) => {
      const correlacionId = randomUUID();
      try {
        await this.prisma.avisoInternoEnvio.create({
          data: {
            id: correlacionId,
            tenantId,
            orderId: orden.id,
            canalConfigId: configEvento.canalConfigId,
            evento: NotificacionEvento.PEDIDO_MODIFICADO_CLIENTE,
            folio: orden.folio,
            negocioNombre,
            destinatarioId: d.id,
            destinatarioNombre: d.nombre,
            telefonoUltimos4: ultimos4(d.telefono),
          },
        });
      } catch (error: unknown) {
        this.logger.error(`No se pudo registrar el aviso interno (tenant=${tenantId}, tipo=${tipoDeError(error)}); no se envía`);
        return;
      }

      const cuerpo = construirPayloadAviso({
        correlacionId,
        negocioSlug: tenant.slug,
        telefonoGuardado: d.telefono,
        negocioNombre,
        semanaInicio,
        orderId: orden.id,
      });
      let fallo: string | null = null;
      try {
        const res = await this.webhook.post({ url, secreto: tenant.botWebhookSecret, cuerpo });
        if (!res.ok) fallo = `HTTP ${res.status}`;
      } catch (error: unknown) {
        const tipo = tipoDeError(error);
        fallo = tipo === 'timeout' ? 'Sin respuesta de Botpress (timeout)' : 'Error de red';
      }
      if (fallo === null) {
        this.logger.log(`Aviso interno aceptado por Botpress (tenant=${tenantId}, envio=${correlacionId}) — en curso`);
        return;
      }
      this.logger.warn(`Aviso interno fallido (tenant=${tenantId}, envio=${correlacionId}): ${fallo}`);
      await this.prisma.avisoInternoEnvio
        .updateMany({
          where: { id: correlacionId, tenantId, estado: 'EN_CURSO' },
          data: { estado: 'FALLO', motivo: fallo, resueltoAt: new Date() },
        })
        .catch(() => undefined);
    };

    // Concurrencia acotada: CONCURRENCIA_AVISOS trabajadores reparten la lista.
    const cola = [...destinatarios];
    const trabajador = async () => {
      for (let d = cola.shift(); d; d = cola.shift()) await enviar(d);
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_AVISOS, cola.length) }, trabajador));
  }

  /**
   * Callback de Botpress (PATCH /internal/avisos-pedido/:id/estado). 404 si no existe o es de otro negocio. Un estado final no
   * cambia: un callback repetido o tardío devuelve el estado vigente.
   */
  async actualizarEstadoDesdeCallback(
    tenantId: string,
    id: string,
    estado: 'EXITO' | 'FALLO',
    motivo: string | undefined,
  ): Promise<{ id: string; estado: 'EN_CURSO' | 'EXITO' | 'FALLO' } | null> {
    const aviso = await this.prisma.avisoInternoEnvio.findFirst({ where: { id, tenantId }, select: { estado: true } });
    if (!aviso) return null;
    if (aviso.estado === 'EN_CURSO') {
      // Atómico: si otro callback se adelantó, no cambia nada y abajo se lee el estado vigente.
      await this.prisma.avisoInternoEnvio.updateMany({
        where: { id, tenantId, estado: 'EN_CURSO' },
        data: { estado, motivo: motivo ?? null, resueltoAt: new Date() },
      });
    }
    const vigente = await this.prisma.avisoInternoEnvio.findFirst({ where: { id, tenantId }, select: { estado: true } });
    return vigente ? { id, estado: vigente.estado } : null;
  }
}

function leerDestinatarios(config: unknown): DestinatarioWhatsapp[] {
  const lista = (config as { destinatarios?: unknown } | null)?.destinatarios;
  if (!Array.isArray(lista)) return [];
  return (lista as Partial<DestinatarioWhatsapp>[]).filter(
    (d): d is DestinatarioWhatsapp =>
      !!d && typeof d.id === 'string' && typeof d.nombre === 'string' && typeof d.telefono === 'string' && d.telefono.length > 0,
  );
}

/** Clasifica un error sin exponer su mensaje (puede traer la URL del webhook o datos personales). */
function tipoDeError(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout';
  return error instanceof Error ? 'error' : 'desconocido';
}
