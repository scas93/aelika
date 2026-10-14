import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PedidoB2bModoCobro } from '../../../generated/prisma/enums';

// El código no está aquí a propósito: no se edita, y el ValidationPipe (whitelist) descarta cualquier `codigo` que llegue.
// `null` en descuento/modalidad los borra (sin descuento / la modalidad del negocio); ausente no los toca.
export class UpdateClienteB2bDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  direccion?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  descuentoPorcentaje?: number | null;

  @IsOptional()
  @IsEnum(PedidoB2bModoCobro)
  modalidadPago?: PedidoB2bModoCobro | null;
}
