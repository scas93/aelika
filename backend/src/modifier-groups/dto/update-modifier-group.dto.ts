import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TipoSeleccion } from '../../../generated/prisma/enums';

export class UpdateModifierGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre?: string;

  @IsOptional()
  @IsEnum(TipoSeleccion)
  tipoSeleccion?: TipoSeleccion;

  @IsOptional()
  @IsBoolean()
  obligatorio?: boolean;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
