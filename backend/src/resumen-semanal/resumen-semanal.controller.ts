import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Put,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { Role, TipoStorefront } from '../../generated/prisma/enums';
import { normalizarCorreo } from '../notificaciones/notificacion-correo-resumen';
import { ResumenSemanalEnvioService } from './resumen-semanal-envio.service';
import { ResumenSemanalClienteEnvioService } from './resumen-semanal-cliente-envio.service';
import { semanaAnterior, type SemanaResumen } from './resumen-semanal';
import { sumarDiasISO } from '../pedidos-b2b/pedidos-b2b-logica';
import {
  ConfigResumenClientesDto,
  PruebaResumenClienteDto,
  PruebaResumenNegocioDto,
} from './dto/resumen-semanal.dto';

/** «2026-10-26» → la semana (lunes a domingo). 400 si no es una fecha real o no es lunes. */
export function semanaDeLunes(lunes: string | undefined, ahora = new Date()): SemanaResumen {
  if (lunes === undefined) return semanaAnterior(ahora);
  const fecha = new Date(`${lunes}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== lunes) {
    throw new BadRequestException('La semana no es una fecha válida');
  }
  if (fecha.getUTCDay() !== 1) {
    throw new BadRequestException('La semana debe empezar en lunes');
  }
  return { inicio: lunes, fin: sumarDiasISO(lunes, 6) };
}

// Solo Dueño, como el resto de Ajustes → Notificaciones.
@Roles(Role.DUENO)
@Controller('notificaciones/resumen-semanal')
export class ResumenSemanalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: ResumenSemanalEnvioService,
    private readonly envioClientes: ResumenSemanalClienteEnvioService,
  ) {}

  private async negocioMayoreo(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { nombre: true, tipoStorefront: true, correoRespuestas: true },
    });
    if (tenant.tipoStorefront !== TipoStorefront.RETAIL_B2B) {
      throw new ForbiddenException(
        'El resumen semanal solo está disponible para negocios de mayoreo',
      );
    }
    return tenant;
  }

  /**
   * «Enviar resumen de prueba»: manda ahora el resumen de la semana elegida (por defecto la anterior) a la lista del canal Correo
   * (aunque el canal aún no esté activo, para poder probarlo antes de activarlo). Se registra como PRUEBA: no consume ni bloquea
   * el envío del lunes y se puede repetir. Un fallo del envío NO es un error HTTP: responde 200 con `resultado: 'FALLO'`.
   */
  @Post('prueba')
  @HttpCode(200)
  async prueba(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PruebaResumenNegocioDto,
  ) {
    await this.negocioMayoreo(user.tenantId);
    const semana = semanaDeLunes(dto?.semanaInicio);
    const config = await this.envio.configDelNegocio(user.tenantId);
    const r = await this.envio.enviar(user.tenantId, semana, 'PRUEBA', config);
    return {
      resultado: r.resultado === 'EXITO' ? 'EXITO' : 'FALLO',
      motivo: r.motivo ?? null,
      destinatarios: r.destinatarios,
      conPedidos: r.conPedidos ?? false,
      semanaInicio: semana.inicio,
      semanaFin: semana.fin,
    };
  }

  // ---- Resumen para clientes -------------------------------------------------------------------

  /** Correo de respuestas (Reply-To) del negocio para los resúmenes de sus clientes. */
  @Get('clientes/config')
  async configClientes(@CurrentUser() user: JwtPayload) {
    const t = await this.negocioMayoreo(user.tenantId);
    // Contador de la tarjeta del panel: clientes B2B sin baja con el envío encendido y un correo capturado.
    const clientesConEnvio = await this.prisma.cliente.count({
      where: {
        tenantId: user.tenantId,
        canal: 'B2B',
        bajaAt: null,
        resumenSemanalActivo: true,
        resumenSemanalCorreo: { not: null },
      },
    });
    return { correoRespuestas: t.correoRespuestas, clientesConEnvio };
  }

  @Put('clientes/config')
  async guardarConfigClientes(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfigResumenClientesDto,
  ) {
    await this.negocioMayoreo(user.tenantId);
    const crudo = dto.correoRespuestas;
    const correoRespuestas =
      crudo === null || crudo === undefined || crudo.trim() === ''
        ? null
        : normalizarCorreo(crudo);
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { correoRespuestas },
    });
    return { correoRespuestas };
  }

  /**
   * Prueba del resumen de UN cliente: la misma plantilla y Excel que recibiría, enviados a la dirección que escribe el Dueño (no
   * al cliente), de la semana elegida (por defecto la anterior). No crea marca ni consume el envío del lunes. 409 si el cliente
   * no tuvo pedidos esa semana. Un fallo de Resend responde 200 con `resultado: 'FALLO'`.
   */
  @Post('clientes/prueba')
  @HttpCode(200)
  async pruebaCliente(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PruebaResumenClienteDto,
  ) {
    const negocio = await this.negocioMayoreo(user.tenantId);
    const semana = semanaDeLunes(dto.semanaInicio);
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, tenantId: user.tenantId, canal: 'B2B' },
      select: { id: true, nombre: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    const destino = normalizarCorreo(dto.correo);
    const r = await this.envioClientes.enviarPrueba(
      { id: cliente.id, tenantId: user.tenantId, nombre: cliente.nombre },
      { nombre: negocio.nombre, correoRespuestas: negocio.correoRespuestas },
      semana,
      destino,
    );
    if (r.resultado === 'SIN_PEDIDOS') {
      throw new ConflictException(
        'Este cliente no tuvo pedidos en esa semana: no hay nada que enviar',
      );
    }
    return {
      resultado: r.resultado,
      motivo: 'motivo' in r ? (r.motivo ?? null) : null,
      semanaInicio: semana.inicio,
      semanaFin: semana.fin,
    };
  }
}
