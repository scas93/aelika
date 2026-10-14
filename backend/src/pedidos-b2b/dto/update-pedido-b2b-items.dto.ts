import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  ValidateNested,
} from 'class-validator';
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

  // Control de concurrencia opcional y aditivo (Fase 4 · 4f): el `updatedAt` del pedido tal como lo cargó el panel. Si el
  // pedido cambió desde entonces (p. ej. el cliente lo modificó en el portal) → 409. Sin `version` el comportamiento
  // es el de siempre.
  @IsOptional()
  @IsISO8601()
  version?: string;
}
