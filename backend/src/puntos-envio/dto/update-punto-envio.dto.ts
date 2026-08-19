import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdatePuntoEnvioDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  direccion?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  pedidoMinimo?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
