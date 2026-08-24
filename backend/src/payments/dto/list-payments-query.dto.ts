import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { EstadoPago } from '../../../generated/prisma/enums';

// desde/hasta filter on Payment.createdAt, same pattern as
// ListOrdersHistoricoQueryDto. paymentMethodType (not a MetodoPago-style
// enum) is Stripe's own free-form string on Payment — exposed as-is instead
// of normalized against Order.metodoPago, since today it's always "card"
// and there's no shared vocabulary to map it into.
export class ListPaymentsQueryDto {
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
