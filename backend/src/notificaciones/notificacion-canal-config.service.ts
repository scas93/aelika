import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { NotificacionCanalTipo } from '../../generated/prisma/enums';
import { validarConfigWhatsapp } from './notificacion-whatsapp';
import {
  CANALES_MAYOREO,
  esMayoreo,
  exigirCanalPermitido,
} from './notificacion-reglas-negocio';
import {
  correosDeConfig,
  validarConfigCorreoResumen,
} from './notificacion-correo-resumen';

const PRISMA_NOT_FOUND = 'P2025';
const PRISMA_UNIQUE_CONSTRAINT = 'P2002';

const MSG_SIN_WEBHOOK =
  'Configura primero la URL del webhook en Conexión WhatsApp para poder activar este canal';
const MSG_SIN_CORREOS =
  'Un canal de correo activo necesita al menos una dirección. Desactívalo primero o agrega una';
const MSG_SIN_DESTINATARIOS =
  'Un canal de WhatsApp activo necesita al menos un destinatario. Desactívalo primero o agrega uno';

export interface CreateNotificacionCanalConfigInput {
  tipo: NotificacionCanalTipo;
  // Shape depends on `tipo` — see the comment on NotificacionCanalConfig in
  // schema.prisma. Solo WHATSAPP se valida por forma aquí (validarConfigWhatsapp); Telegram y Correo siguen sin validación.
  config: Record<string, unknown>;
  activo?: boolean;
}

export interface UpdateNotificacionCanalConfigInput {
  config?: Record<string, unknown>;
  activo?: boolean;
}

/**
 * CRUD for NotificacionCanalConfig — one row per NotificacionCanalTipo per
 * tenant (enforced by the @@unique([tenantId, tipo]) constraint, see
 * schema.prisma). Same shape as PuntosEnvioService: tenant isolation comes
 * for free from TenantPrismaService, no service-level tenantId handling.
 */
@Injectable()
export class NotificacionCanalConfigService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  private async negocio(tenantId: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { tipoStorefront: true, botWebhookUrl: true },
    });
  }

  /** Mayoreo solo ve los canales de WhatsApp y Correo: si le quedaron filas viejas de otros canales no se borran, solo no se muestran. */
  async findAll(tenantId: string) {
    const { tipoStorefront } = await this.negocio(tenantId);
    return this.tenantPrisma.client.notificacionCanalConfig.findMany({
      where: esMayoreo(tipoStorefront) ? { tipo: { in: CANALES_MAYOREO } } : {},
      orderBy: { tipo: 'asc' },
    });
  }

  async findOne(id: string) {
    const canal =
      await this.tenantPrisma.client.notificacionCanalConfig.findUnique({
        where: { id },
      });
    if (!canal) {
      throw new NotFoundException('Configuración de canal no encontrada');
    }
    return canal;
  }

  async create(tenantId: string, dto: CreateNotificacionCanalConfigInput) {
    const negocio = await this.negocio(tenantId);
    exigirCanalPermitido(negocio.tipoStorefront, dto.tipo);
    const correoMayoreo =
      esMayoreo(negocio.tipoStorefront) &&
      dto.tipo === NotificacionCanalTipo.CORREO;
    // El correo del resumen semanal (mayoreo) nace inactivo: cada negocio lo activa por su cuenta. Los demás canales, como siempre.
    const activo = dto.activo ?? !correoMayoreo;
    let config = dto.config;
    if (dto.tipo === NotificacionCanalTipo.WHATSAPP) {
      config = { ...validarConfigWhatsapp(dto.config) };
      this.exigirActivable(
        activo,
        config.destinatarios as unknown[],
        negocio.botWebhookUrl,
        true,
      );
    } else if (correoMayoreo) {
      config = { ...validarConfigCorreoResumen(dto.config) };
      this.exigirCorreosSiActivo(activo, config.correos as string[]);
    }
    try {
      return await this.tenantPrisma.client.notificacionCanalConfig.create({
        // tenantId is required by the generated types but injected at runtime
        // by the tenant-scoped query extension (see TenantPrismaService).
        data: {
          tipo: dto.tipo,
          config: config as any,
          activo,
        } as any,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_UNIQUE_CONSTRAINT) {
        throw new ConflictException(
          'Ya existe un canal de este tipo para tu negocio',
        );
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateNotificacionCanalConfigInput,
  ) {
    const existente = await this.findOne(id);
    const negocio = await this.negocio(tenantId);
    exigirCanalPermitido(negocio.tipoStorefront, existente.tipo);
    let data: UpdateNotificacionCanalConfigInput = dto;
    if (
      esMayoreo(negocio.tipoStorefront) &&
      existente.tipo === NotificacionCanalTipo.CORREO
    ) {
      const config =
        dto.config !== undefined
          ? { ...validarConfigCorreoResumen(dto.config) }
          : {
              ...(existente.config as Record<string, unknown>),
              correos: correosDeConfig(existente.config),
            };
      this.exigirCorreosSiActivo(
        dto.activo ?? existente.activo,
        config.correos as string[],
      );
      data = { ...dto, ...(dto.config !== undefined ? { config } : {}) };
    } else if (existente.tipo === NotificacionCanalTipo.WHATSAPP) {
      const config =
        dto.config !== undefined
          ? { ...validarConfigWhatsapp(dto.config) }
          : (existente.config as Record<string, unknown>);
      const activo = dto.activo ?? existente.activo;
      // El webhook solo se exige al ACTIVAR (apagado → encendido o alta); editar destinatarios de uno ya activo no lo revisa.
      this.exigirActivable(
        activo,
        config.destinatarios as unknown[],
        negocio.botWebhookUrl,
        dto.activo === true && !existente.activo,
      );
      data = { ...dto, ...(dto.config !== undefined ? { config } : {}) };
    }
    try {
      return await this.tenantPrisma.client.notificacionCanalConfig.update({
        where: { id },
        data: data as any,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Configuración de canal no encontrada');
      }
      throw error;
    }
  }

  /** CORREO de mayoreo activo ⇒ al menos 1 dirección (409). */
  private exigirCorreosSiActivo(activo: boolean, correos: string[]) {
    if (activo && correos.length < 1)
      throw new ConflictException(MSG_SIN_CORREOS);
  }

  /** WHATSAPP activo ⇒ al menos 1 destinatario (409) y, al activar, la URL del webhook de Conexión WhatsApp (409). */
  private exigirActivable(
    activo: boolean,
    destinatarios: unknown[],
    botWebhookUrl: string | null,
    activando: boolean,
  ) {
    if (!activo) return;
    if (destinatarios.length < 1)
      throw new ConflictException(MSG_SIN_DESTINATARIOS);
    if (activando && !botWebhookUrl?.trim())
      throw new ConflictException(MSG_SIN_WEBHOOK);
  }

  /**
   * No FK-conflict handling needed (unlike PuntosEnvioService.remove):
   * NotificacionEventoConfig.canalConfig is onDelete: Cascade — deleting a
   * channel just removes the event rules that pointed at it, on purpose (see
   * schema.prisma comment on that relation).
   */
  async remove(id: string) {
    try {
      await this.tenantPrisma.client.notificacionCanalConfig.delete({
        where: { id },
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Configuración de canal no encontrada');
      }
      throw error;
    }
  }
}
