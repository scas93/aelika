import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PedidoB2bModoCobro } from '../../../generated/prisma/enums';

// El código no está aquí a propósito: no se edita, y el ValidationPipe (whitelist) descarta cualquier `codigo` que llegue.
// `null` en descuento lo borra (sin descuento); ausente no lo toca. La modalidad no se puede borrar: es obligatoria.
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

  // undefined = no cambia. null NO es válido (la modalidad es obligatoria): ValidateIf deja pasar null al IsEnum, que lo rechaza.
  @ValidateIf((_, valor) => valor !== undefined)
  @IsEnum(PedidoB2bModoCobro)
  modalidadPago?: PedidoB2bModoCobro;

  // Resumen semanal por correo (dato PROPIO del cliente; no se prellena ni se toma de Cliente.correo). El interruptor solo puede
  // encenderse con correo capturado; `null` o vacío en el correo lo borra (y apaga el interruptor).
  @IsOptional()
  @IsBoolean()
  resumenSemanalActivo?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  resumenSemanalCorreo?: string | null;
}
