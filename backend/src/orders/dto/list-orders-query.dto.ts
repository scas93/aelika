import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional } from 'class-validator';
import { ESTADOS_B2C } from '../estados-b2c';
import { EstadoPedido } from '../../../generated/prisma/enums';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsIn(ESTADOS_B2C)
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
