import { IsIn } from 'class-validator';

export const ESTADOS_CIERRE_ENTREGA = ['ENTREGADA', 'NO_RECOGIDA'] as const;

// Una entrega se cierra una por una como Entregada o No recogida. Cancelada nunca se pide aquí: solo ocurre al
// cancelar el pedido (no existe cancelar una entrega suelta).
export class CerrarEntregaB2bDto {
  @IsIn(ESTADOS_CIERRE_ENTREGA)
  estado: (typeof ESTADOS_CIERRE_ENTREGA)[number];
}
