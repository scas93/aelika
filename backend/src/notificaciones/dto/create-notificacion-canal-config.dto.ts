import { IsBoolean, IsEnum, IsObject, IsOptional } from 'class-validator';
import { NotificacionCanalTipo } from '../../../generated/prisma/enums';

export class CreateNotificacionCanalConfigDto {
  @IsEnum(NotificacionCanalTipo)
  tipo: NotificacionCanalTipo;

  // Shape depende de `tipo` — ver el comentario de NotificacionCanalConfig en
  // schema.prisma. No se valida por-shape aquí a propósito, mismo criterio
  // que Promotion.config: la validación real de negocio vive donde se
  // consume (CorreoProvider), no en el DTO de entrada.
  @IsObject()
  config: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
