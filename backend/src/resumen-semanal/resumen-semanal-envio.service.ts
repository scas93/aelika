import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CorreoProvider } from '../notificaciones/providers/correo.provider';
import { correosDeConfig, normalizarCorreo } from '../notificaciones/notificacion-correo-resumen';
import { ResumenSemanalArmadoService } from './resumen-semanal-armado.service';
import { fechaDeSemana } from '../notificaciones-reglas/recordatorio-semanal';
import type { SemanaResumen } from './resumen-semanal';

const PRISMA_UNIQUE = 'P2002';
const MAX_MOTIVO = 300;

export type TipoEnvioResumen = 'PROGRAMADO' | 'PRUEBA';

export interface ResultadoEnvioResumen {
  /** 'DUPLICADO': ya existía el resumen programado de esa semana (otra instancia o una ejecución anterior); no se envía nada. */
  resultado: 'EXITO' | 'FALLO' | 'DUPLICADO';
  envioId?: string;
  motivo?: string;
  destinatarios: number;
  conPedidos?: boolean;
}

/** Motivo apto para guardar y loguear: sin direcciones de correo, una línea y acotado. */
export function motivoSeguro(motivo: unknown): string {
  const texto = typeof motivo === 'string' ? motivo : motivo instanceof Error ? motivo.message : 'Error desconocido';
  return texto
    .replace(/[^\s@<>()",;]+@[^\s@<>()",;]+/g, '***@***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MOTIVO);
}

/**
 * Envío del resumen semanal de UN negocio de mayoreo y su registro (`ResumenSemanalEnvio`). Sin sesión de usuario:
 * `PrismaService` con `tenantId` explícito. Nunca lanza por un fallo de armado o de envío: lo deja registrado como FALLO.
 *
 * Duplicados: el envío PROGRAMADO crea primero su fila con `semanaProgramada` y el índice único (negocio, semana) es la reserva;
 * quien pierde la carrera (P2002) no envía nada. Las PRUEBAS dejan `semanaProgramada` en NULL: no reservan ni bloquean nada.
 */
@Injectable()
export class ResumenSemanalEnvioService {
  private readonly logger = new Logger(ResumenSemanalEnvioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly armado: ResumenSemanalArmadoService,
    private readonly correo: CorreoProvider,
  ) {}

  /** Envía el resumen de `semana` con la configuración del canal Correo del negocio. */
  async enviar(
    tenantId: string,
    semana: SemanaResumen,
    tipo: TipoEnvioResumen,
    config: { nombreRemitente: string; correos: string[] },
  ): Promise<ResultadoEnvioResumen> {
    const correos = this.direccionesValidas(config.correos);
    const programada = tipo === 'PROGRAMADO' ? fechaDeSemana(semana.inicio) : null;

    let envioId: string;
    try {
      const fila = await this.prisma.resumenSemanalEnvio.create({
        data: { tenantId, semanaInicio: fechaDeSemana(semana.inicio), semanaProgramada: programada, tipo, destinatarios: correos.length },
        select: { id: true },
      });
      envioId = fila.id;
    } catch (error: any) {
      if (error?.code === PRISMA_UNIQUE) return { resultado: 'DUPLICADO', destinatarios: correos.length };
      throw error;
    }

    let resultado: 'EXITO' | 'FALLO' = 'FALLO';
    let motivo: string | undefined;
    let conPedidos = false;
    try {
      if (correos.length === 0) {
        motivo = 'El canal de correo no tiene direcciones válidas';
      } else {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { nombre: true } });
        const armado = await this.armado.armar(tenantId, tenant?.nombre ?? 'Tu negocio', semana);
        conPedidos = armado.totales.hayPedidos;
        const envio = await this.correo.enviarConAdjuntos({
          destinatarios: correos,
          nombreRemitente: config.nombreRemitente,
          mensaje: armado.correo,
          adjuntos: armado.adjunto ? [armado.adjunto] : undefined,
        });
        if (envio.exito) resultado = 'EXITO';
        else motivo = motivoSeguro(envio.error);
      }
    } catch (error: unknown) {
      motivo = motivoSeguro(error);
    }

    await this.prisma.resumenSemanalEnvio.update({
      where: { id: envioId },
      data: { estado: resultado, motivo: resultado === 'FALLO' ? motivo : null, conPedidos, resueltoAt: new Date() },
    });
    this.logger.log(
      `Resumen semanal ${tipo} (tenant=${tenantId}, semana=${semana.inicio}, destinatarios=${correos.length}): ${resultado}${motivo ? ` — ${motivo}` : ''}`,
    );
    return { resultado, envioId, motivo, destinatarios: correos.length, conPedidos };
  }

  /** Solo direcciones que pasan la validación (lectura tolerante de una config vieja o editada a mano). */
  private direccionesValidas(correos: string[]): string[] {
    const vistos = new Set<string>();
    for (const c of correos) {
      try {
        vistos.add(normalizarCorreo(c));
      } catch {
        // dirección inválida en la base: se omite
      }
    }
    return [...vistos];
  }

  /** Configuración del canal Correo de un negocio de mayoreo (para el botón de prueba). 409 si no hay canal o direcciones. */
  async configDelNegocio(tenantId: string): Promise<{ nombreRemitente: string; correos: string[] }> {
    const canal = await this.prisma.notificacionCanalConfig.findFirst({ where: { tenantId, tipo: 'CORREO' } });
    const cfg = (canal?.config ?? {}) as { nombreRemitente?: unknown };
    const correos = canal ? correosDeConfig(canal.config) : [];
    if (!canal || correos.length === 0) {
      throw new ConflictException('Configura primero el canal de correo con al menos una dirección');
    }
    return { nombreRemitente: typeof cfg.nombreRemitente === 'string' ? cfg.nombreRemitente : '', correos };
  }
}
