import { Controller, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { Role, TipoStorefront } from '../../generated/prisma/enums';
import { ResumenSemanalEnvioService } from './resumen-semanal-envio.service';
import { semanaAnterior } from './resumen-semanal';

// Solo Dueño, como el resto de Ajustes → Notificaciones.
@Roles(Role.DUENO)
@Controller('notificaciones/resumen-semanal')
export class ResumenSemanalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: ResumenSemanalEnvioService,
  ) {}

  /**
   * «Enviar resumen de prueba»: manda ahora el resumen de la semana anterior a la lista del canal Correo (aunque el canal aún no
   * esté activo, para poder probarlo antes de activarlo). Se registra como PRUEBA: no consume ni bloquea el envío del lunes y se
   * puede repetir. Un fallo del envío NO es un error HTTP: responde 200 con `resultado: 'FALLO'` y el motivo.
   */
  @Post('prueba')
  @HttpCode(200)
  async prueba(@CurrentUser() user: JwtPayload) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { tipoStorefront: true } });
    if (tenant.tipoStorefront !== TipoStorefront.RETAIL_B2B) {
      throw new ForbiddenException('El resumen semanal solo está disponible para negocios de mayoreo');
    }
    const config = await this.envio.configDelNegocio(user.tenantId);
    const semana = semanaAnterior(new Date());
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
}
