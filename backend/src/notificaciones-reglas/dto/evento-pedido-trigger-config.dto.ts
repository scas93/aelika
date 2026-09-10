import { IsEnum, IsString } from 'class-validator';
import { ReglaTriggerOrigenPedido } from '../../../generated/prisma/enums';

/**
 * Shape de `Regla.triggerConfig` cuando `trigger = EVENTO_PEDIDO` — ver
 * comentario del campo en schema.prisma. `estatus` se valida como string
 * aquí (shape); que sea un valor real de EstadoPedido/PedidoB2bEstado según
 * `origen` se revisa en ReglasService.validarPayload (son dos enums
 * distintos, no uno solo — ver ReglaTriggerOrigenPedido).
 */
export class EventoPedidoTriggerConfigDto {
  @IsEnum(ReglaTriggerOrigenPedido)
  origen: ReglaTriggerOrigenPedido;

  @IsString()
  estatus: string;
}
