import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { EstadoPedido, MetodoPago } from '../../../generated/prisma/enums';

// desde/hasta filter on Order.createdAt, same field ListOrdersQueryDto already
// filters on — no separate "fecha" concept introduced here.
export class ListOrdersHistoricoQueryDto {
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
