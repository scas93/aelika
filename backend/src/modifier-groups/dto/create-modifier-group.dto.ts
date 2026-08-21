import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { TipoSeleccion } from '../../../generated/prisma/enums';
import { CreateModifierOptionDto } from './create-modifier-option.dto';

export class CreateModifierGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre: string;

  @IsEnum(TipoSeleccion)
  tipoSeleccion: TipoSeleccion;

  @IsOptional()
  @IsBoolean()
  obligatorio?: boolean;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // Optional so a group can be created empty and have opciones added
  // afterward via POST /modifier-groups/:id/opciones.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateModifierOptionDto)
  opciones?: CreateModifierOptionDto[];
}
