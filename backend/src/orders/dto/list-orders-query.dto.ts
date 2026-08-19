import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { EstadoPedido } from '../../../generated/prisma/enums';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(EstadoPedido)
  estadoPedido?: EstadoPedido;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
