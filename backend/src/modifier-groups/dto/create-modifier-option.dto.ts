import { IsBoolean, IsNumber, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator';

export class CreateModifierOptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioAdicional?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
