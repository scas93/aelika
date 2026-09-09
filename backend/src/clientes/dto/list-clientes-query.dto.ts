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

export type ClienteOrdenarPor = 'ultimoPedidoAt' | 'totalPedidos';

// Búsqueda por nombre o teléfono en un solo campo — ver
// ClientesService.buildWhere para cómo se resuelve contra `nombre` (contains
// insensitive) y `telefono` (solo dígitos, comparado contra el teléfono ya
// normalizado guardado en DB).
export class ListClientesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(['ultimoPedidoAt', 'totalPedidos'])
  ordenarPor: ClienteOrdenarPor = 'ultimoPedidoAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  orden: 'asc' | 'desc' = 'desc';

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
