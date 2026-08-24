import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { EstadoPedido, MetodoPago } from '../../../generated/prisma/enums';

// Same filters as ListOrdersHistoricoQueryDto minus page/limit — the export
// endpoint has no pagination, it returns every matching row as CSV.
export class ExportOrdersHistoricoQueryDto {
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
}
