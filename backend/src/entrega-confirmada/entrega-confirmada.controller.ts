import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { Role, TipoStorefront } from '../../generated/prisma/enums';
import { EntregaConfirmadaService } from './entrega-confirmada.service';
import { PruebaEntregaConfirmadaDto } from './dto/entrega-confirmada.dto';

// Mismos permisos que la configuración del resumen semanal: solo Dueño, como el resto de Ajustes → Notificaciones.
@Roles(Role.DUENO)
@Controller('notificaciones/entrega-confirmada')
export class EntregaConfirmadaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servicio: EntregaConfirmadaService,
  ) {}

  /**
   * Prueba con UN cliente: el mismo correo que recibiría (con su entrega entregada más reciente), enviado a la dirección que escribe
   * el Dueño (no al cliente). No depende de los interruptores ni deja registro. 409 si el cliente aún no tiene entregas entregadas.
   * Un fallo de Resend responde 200 con `resultado: 'FALLO'`.
   */
  @Post('prueba')
  @HttpCode(200)
  async prueba(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PruebaEntregaConfirmadaDto,
  ) {
    const negocio = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { nombre: true, tipoStorefront: true, correoRespuestas: true },
    });
    if (negocio.tipoStorefront !== TipoStorefront.RETAIL_B2B) {
      throw new ForbiddenException(
        'El aviso de entrega confirmada solo está disponible para negocios de mayoreo',
      );
    }
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, tenantId: user.tenantId, canal: 'B2B' },
      select: { id: true, nombre: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    const r = await this.servicio.enviarPrueba(
      user.tenantId,
      cliente,
      { nombre: negocio.nombre, correoRespuestas: negocio.correoRespuestas },
      dto.correo,
    );
    if (r.resultado === 'SIN_ENTREGAS') {
      throw new ConflictException(
        'Este cliente aún no tiene entregas entregadas: no hay nada que enviar como prueba',
      );
    }
    return {
      resultado: r.resultado,
      motivo: r.motivo ?? null,
      fechaEntrega: r.fechaEntrega,
    };
  }
}
