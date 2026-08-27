import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateCodigoDescuentoB2bDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message:
      'El código solo puede contener letras, números, guiones y guiones bajos',
  })
  codigo?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100)
  descuentoPorcentaje?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // Omitido = no tocar, null = limpiar (vuelve a "ilimitado").
  @IsOptional()
  @IsInt()
  @IsPositive()
  usosMaximos?: number | null;

  // "YYYY-MM-DD". Omitido = no tocar, null = limpiar (vuelve a "sin fecha límite").
  @IsOptional()
  @IsDateString({ strict: true })
  fechaLimite?: string | null;
}
