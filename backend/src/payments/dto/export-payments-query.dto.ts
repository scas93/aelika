import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { EstadoPago } from '../../../generated/prisma/enums';

// Same filters as ListPaymentsQueryDto minus page/limit — the export
// endpoint has no pagination, it returns every matching row as CSV.
export class ExportPaymentsQueryDto {
  @IsOptional()
  @IsEnum(EstadoPago)
  status?: EstadoPago;

  @IsOptional()
  @IsString()
  paymentMethodType?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
