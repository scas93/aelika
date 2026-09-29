import { IsDateString, IsEnum, IsIn, IsOptional } from 'class-validator';
import { EstadoPedido, MetodoPago } from '../../../generated/prisma/enums';
import { GRUPOS_ESTADO_PAGO, type GrupoEstadoPago } from '../../common/estado-pago';

// Same filters as ListOrdersHistoricoQueryDto minus page/limit — the export
// endpoint has no pagination, it returns every matching row as CSV.
export class ExportOrdersHistoricoQueryDto {
  @IsOptional()
  @IsEnum(EstadoPedido)
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
}
