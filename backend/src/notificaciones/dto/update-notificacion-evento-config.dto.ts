import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateNotificacionEventoConfigDto {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // Permite cambiar de canal sin borrar+recrear la fila — el selector de
  // canal en el dashboard (Fase E) hace un solo PATCH al cambiar de opción.
  @IsOptional()
  @IsUUID()
  canalConfigId?: string;
}
