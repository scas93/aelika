import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PedidoB2bItemInputDto } from './pedido-b2b-item-input.dto';

/**
 * Captura de un pedido B2B desde el panel: el pedido pertenece a un cliente B2B dado de alta (clientes-b2b). El nombre
 * del negocio, el contacto, el descuento y la modalidad de cobro salen del cliente; el cliente nunca manda precios.
 */
export class CreatePedidoB2bDto {
  @IsUUID()
  clienteId: string;

  // "YYYY-MM-DD" — debe ser un lunes real, validado en PedidosB2bService
  // (no a nivel de DTO, para poder dar un mensaje claro en español).
  @IsDateString()
  semanaInicio: string;

  // Nota libre del cliente (opcional).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notaCliente?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PedidoB2bItemInputDto)
  items: PedidoB2bItemInputDto[];
}
