import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ESTADOS_B2C } from '../estados-b2c';
import { EstadoPedido, MetodoPago } from '../../../generated/prisma/enums';
import { GRUPOS_ESTADO_PAGO, type GrupoEstadoPago } from '../../common/estado-pago';
import { FiltroImporteQueryDto } from '../../common/dto/filtro-importe-query.dto';

// desde/hasta filter on Order.createdAt, same field ListOrdersQueryDto already
// filters on — no separate "fecha" concept introduced here. operador/valor/
// valorHasta (heredados de FiltroImporteQueryDto) filtran sobre Order.total.
export class ListOrdersHistoricoQueryDto extends FiltroImporteQueryDto {
  @IsOptional()
  @IsIn(ESTADOS_B2C)
  estadoPedido?: EstadoPedido;

  @IsOptional()
  @IsEnum(MetodoPago)
  metodoPago?: MetodoPago;

  // Estado de pago agrupado (ver common/estado-pago.ts), no los 5 valores crudos.
  @IsOptional()
  @IsIn(GRUPOS_ESTADO_PAGO)
  estadoPago?: GrupoEstadoPago;

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
