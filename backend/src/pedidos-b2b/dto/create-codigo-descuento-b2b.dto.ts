import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCodigoDescuentoB2bDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message:
      'El código solo puede contener letras, números, guiones y guiones bajos',
  })
  codigo: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100)
  descuentoPorcentaje: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
