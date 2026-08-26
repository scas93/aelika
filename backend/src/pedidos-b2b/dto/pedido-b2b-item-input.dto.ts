import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { PedidoB2bItemDiaInputDto } from './pedido-b2b-item-dia-input.dto';

// Never carries a price — same principle as OrderItemInputDto: the server
// always resolves nombreProducto/precioUnitario from Product itself
// (PedidosB2bService), never trusts a client-supplied amount.
export class PedidoB2bItemInputDto {
  @IsUUID()
  productId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PedidoB2bItemDiaInputDto)
  distribucion: PedidoB2bItemDiaInputDto[];
}
