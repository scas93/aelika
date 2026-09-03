import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpdateNotificacionCanalConfigDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
