import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { NotificacionAudiencia, NotificacionEvento } from '../../../generated/prisma/enums';

export class CreateNotificacionEventoConfigDto {
  @IsEnum(NotificacionEvento)
  evento: NotificacionEvento;

  @IsEnum(NotificacionAudiencia)
  audiencia: NotificacionAudiencia;

  @IsUUID()
  canalConfigId: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
