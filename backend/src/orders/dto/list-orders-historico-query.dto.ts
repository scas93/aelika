import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { EstadoPedido, MetodoPago } from '../../../generated/prisma/enums';
import { FiltroImporteQueryDto } from '../../common/dto/filtro-importe-query.dto';

// desde/hasta filter on Order.createdAt, same field ListOrdersQueryDto already
// filters on — no separate "fecha" concept introduced here. operador/valor/
// valorHasta (heredados de FiltroImporteQueryDto) filtran sobre Order.total.
export class ListOrdersHistoricoQueryDto extends FiltroImporteQueryDto {
  @IsOptional()
  @IsEnum(EstadoPedido)
  estadoPedido?: EstadoPedido;

  @IsOptional()
  @IsEnum(MetodoPago)
  metodoPago?: MetodoPago;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

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
