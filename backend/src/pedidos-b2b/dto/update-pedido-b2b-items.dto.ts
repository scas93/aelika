import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { PedidoB2bItemInputDto } from './pedido-b2b-item-input.dto';

// Full replace, same convention as PromotionsService.update's `config`: the
// client sends the complete new set of items/distribución, not a diff —
// avoids ambiguity about what a partial patch means for a nested structure
// like this one.
export class UpdatePedidoB2bItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PedidoB2bItemInputDto)
  items: PedidoB2bItemInputDto[];
}
