import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsOptional } from 'class-validator';
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

  // Panel activo: "solo pagados + reembolsados" (excluye los intentos de pago
  // TARJETA PENDIENTE/PROCESANDO/FALLIDO). Sin el parámetro el contrato es el
  // de siempre. `@Type(() => Boolean)` no sirve aquí: trataría "false" como true.
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  soloPagados?: boolean;
}
