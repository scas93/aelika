import { ReglaPlantillaVariableFuente } from '../../generated/prisma/enums';

/**
 * Forma de un elemento de `Regla.plantillaVariables` (ver comentario del
 * campo en schema.prisma). Sin DTO/class-validator todavía — mismo motivo
 * que FiltroCondicion (Etapa 1): esta etapa no expone ningún endpoint que
 * lo reciba desde afuera, solo lo consume ReglaEnvioService.
 */
export interface PlantillaVariable {
  posicion: number;
  fuente: ReglaPlantillaVariableFuente;
  valor: string;
}

/**
 * Línea de producto tal como la necesita "Resumen de productos" — mismo
 * shape para Order (OrderItem) y PedidoB2b (PedidoB2bItem), aunque cada uno
 * lo obtenga de un campo de cantidad distinto (`cantidad` vs
 * `cantidadTotal`, ver los callers en OrdersService/PedidosB2bService).
 */
export interface ItemPedidoContexto {
  nombreProducto: string;
  cantidad: number;
}

interface PedidoContextoBase {
  folio: string;
  // Decimal de Prisma — se formatea con plantilla-variable-formato.formatDinero,
  // nunca se opera aritméticamente aquí.
  total: unknown;
  // Valor crudo del enum (EstadoPedido | PedidoB2bEstado) — CATALOGO_VARIABLES
  // lo traduce a texto humano según `origen`.
  estatus: string;
  createdAt: Date;
  items: ItemPedidoContexto[];
}

/**
 * Campos exclusivos de Order (menudeo) — PedidoB2b no tiene tipo de
 * entrega/dirección/método de pago propio (ver auditoría del catálogo de
 * variables). CATALOGO_VARIABLES restringe estas 3 variables a
 * `origen: 'ORDER'`.
 */
export interface PedidoContextoOrder extends PedidoContextoBase {
  origen: 'ORDER';
  metodoEntrega: string;
  direccionCalle: string | null;
  direccionNumero: string | null;
  direccionColonia: string | null;
  metodoPago: string;
}

export interface PedidoContextoPedidoB2b extends PedidoContextoBase {
  origen: 'PEDIDO_B2B';
}

/**
 * Datos del pedido que disparó el envío — solo lo construye
 * ReglaEventoPedidoService (trigger EVENTO_PEDIDO), a partir del Order/
 * PedidoB2b ya actualizado en OrdersService.avanzar /
 * PedidosB2bService.avanzar/marcarPagado. Se pasa explícito a
 * ReglaEnvioService.enviar en vez de que el servicio vuelva a consultar el
 * pedido por su cuenta, porque eso lo obligaría a saber si viene de Order o
 * PedidoB2b — mezclando responsabilidades que hoy no tiene.
 */
export type PedidoContexto = PedidoContextoOrder | PedidoContextoPedidoB2b;
