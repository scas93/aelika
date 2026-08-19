import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePuntoEnvioDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  direccion: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  pedidoMinimo?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
