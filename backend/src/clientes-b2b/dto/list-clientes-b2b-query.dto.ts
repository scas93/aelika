import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ESTADOS_CLIENTE_B2B = ['ACTIVOS', 'BAJA', 'TODOS'] as const;

export class ListClientesB2bQueryDto {
  // Nombre, código o teléfono (solo dígitos; se compara contra los números ya normalizados).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(ESTADOS_CLIENTE_B2B)
  estado: (typeof ESTADOS_CLIENTE_B2B)[number] = 'ACTIVOS';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}
