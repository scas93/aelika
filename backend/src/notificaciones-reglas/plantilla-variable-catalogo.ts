import { Cliente, Tenant } from '../../generated/prisma/client';
import { ReglaPlantillaVariableFuente, ReglaTriggerOrigenPedido, ReglaTriggerTipo } from '../../generated/prisma/enums';
import { PedidoContexto } from './plantilla-variable.type';
import {
  diasDesde,
  ESTADO_PEDIDO_LABEL,
  formatDinero,
  formatFechaHoraCorta,
  formatFechaLarga,
  formatMesAnio,
  METODO_ENTREGA_LABEL,
  METODO_PAGO_LABEL,
  PEDIDO_B2B_ESTADO_LABEL,
  resumenProductos,
} from './plantilla-variable-formato';

/**
 * Fuente única del catálogo de variables de plantilla (dropdown del panel +
 * validación al guardar + resolución al enviar — ver el prompt de esta
 * etapa: "agregar una variable nueva debe implicar tocar UN solo lugar").
 * Agregar una variable nueva es agregar un elemento a CATALOGO_VARIABLES —
 * nada más necesita cambiar:
 *   - GET /reglas/catalogo-variables (ReglasService.catalogoVariables) la
 *     expone al panel automáticamente (sin listas hardcodeadas en frontend).
 *   - ReglasService.validarPlantillaVariables la busca por (fuente, valor)
 *     para validar al guardar.
 *   - ReglaEnvioService.resolverVariables la busca igual para resolver al
 *     enviar.
 *
 * Retrocompatibilidad: las 4 fuentes/valores que ya existían (CAMPO_CLIENTE/
 * "nombre", CAMPO_PEDIDO/"folio", NOMBRE_NEGOCIO/"nombre", VALOR_FIJO) siguen
 * siendo exactamente las mismas entradas aquí — ninguna Regla guardada antes
 * de este catálogo deja de resolver. No hizo falta ninguna migración de
 * datos: `Regla.plantillaVariables` sigue siendo el mismo Json
 * {posicion, fuente, valor} de siempre, solo que ahora `valor` tiene más
 * opciones posibles por `fuente`.
 */

export type RestriccionVariable =
  | { tipo: 'ninguna' }
  // Solo tiene sentido si Regla.trigger = EVENTO_PEDIDO (Order o PedidoB2b)
  // — no hay pedido de contexto en ningún otro tipo de Trigger.
  | { tipo: 'evento_pedido'; motivo: string }
  // Además de EVENTO_PEDIDO, solo aplica si el pedido es de menudeo (Order)
  // — PedidoB2b no tiene tipo de entrega/dirección/método de pago propio.
  | { tipo: 'evento_pedido_menudeo'; motivo: string };

export interface ResolverContexto {
  tenant: Tenant;
  cliente: Cliente;
  contexto: PedidoContexto | undefined;
  ahora: Date;
  storefrontUrl: string;
}

export interface CatalogoVariableDef {
  fuente: ReglaPlantillaVariableFuente;
  valor: string;
  grupo: 'CLIENTE' | 'PEDIDO' | 'NEGOCIO';
  label: string;
  ejemplo: string;
  restriccion: RestriccionVariable;
  /** Texto que se manda si el resolver regresa null/"" (dato no disponible) — nunca vacío, ver sanitizarParaMeta. */
  fallback: string;
  resolver: (ctx: ResolverContexto) => string | null;
}

const SIN_RESTRICCION: RestriccionVariable = { tipo: 'ninguna' };
const SOLO_EVENTO_PEDIDO: RestriccionVariable = {
  tipo: 'evento_pedido',
  motivo: 'Solo en reglas de evento de pedido',
};
const SOLO_EVENTO_PEDIDO_MENUDEO: RestriccionVariable = {
  tipo: 'evento_pedido_menudeo',
  motivo: 'Solo pedidos de menudeo',
};

function direccionEntrega(ctx: PedidoContexto & { origen: 'ORDER' }): string | null {
  const partes = [ctx.direccionCalle && ctx.direccionNumero ? `${ctx.direccionCalle} ${ctx.direccionNumero}` : null, ctx.direccionColonia].filter(
    (parte): parte is string => !!parte && parte.trim() !== '',
  );
  return partes.length > 0 ? partes.join(', ') : null;
}

export const CATALOGO_VARIABLES: CatalogoVariableDef[] = [
  // --- Cliente (disponible en todos los triggers) ---
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_CLIENTE,
    valor: 'nombre',
    grupo: 'CLIENTE',
    label: 'Nombre',
    ejemplo: 'Ana López',
    restriccion: SIN_RESTRICCION,
    fallback: 'cliente',
    resolver: ({ cliente }) => cliente.nombre,
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_CLIENTE,
    valor: 'primerNombre',
    grupo: 'CLIENTE',
    label: 'Primer nombre',
    ejemplo: 'Ana',
    restriccion: SIN_RESTRICCION,
    fallback: 'cliente',
    resolver: ({ cliente }) => cliente.nombre.trim().split(/\s+/)[0] ?? null,
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_CLIENTE,
    valor: 'totalPedidos',
    grupo: 'CLIENTE',
    label: 'Número de pedidos',
    ejemplo: '7',
    restriccion: SIN_RESTRICCION,
    fallback: '0',
    resolver: ({ cliente }) => String(cliente.totalPedidos),
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_CLIENTE,
    valor: 'ultimaCompra',
    grupo: 'CLIENTE',
    label: 'Fecha de última compra',
    ejemplo: '12 de septiembre',
    restriccion: SIN_RESTRICCION,
    fallback: '—',
    resolver: ({ cliente }) => formatFechaLarga(cliente.ultimoPedidoAt),
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_CLIENTE,
    valor: 'diasDesdeUltimaCompra',
    grupo: 'CLIENTE',
    label: 'Días desde última compra',
    ejemplo: '18',
    restriccion: SIN_RESTRICCION,
    fallback: '—',
    resolver: ({ cliente, ahora }) => String(diasDesde(cliente.ultimoPedidoAt, ahora)),
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_CLIENTE,
    valor: 'clienteDesde',
    grupo: 'CLIENTE',
    label: 'Cliente desde',
    ejemplo: 'marzo de 2026',
    restriccion: SIN_RESTRICCION,
    fallback: '—',
    resolver: ({ cliente }) => formatMesAnio(cliente.primerPedidoAt),
  },

  // --- Pedido (solo trigger EVENTO_PEDIDO; Order y PedidoB2b) ---
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_PEDIDO,
    valor: 'folio',
    grupo: 'PEDIDO',
    label: 'Folio',
    ejemplo: 'A-1043',
    restriccion: SOLO_EVENTO_PEDIDO,
    fallback: '—',
    resolver: ({ contexto }) => contexto?.folio ?? null,
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_PEDIDO,
    valor: 'total',
    grupo: 'PEDIDO',
    label: 'Total',
    ejemplo: '$1,245.50',
    restriccion: SOLO_EVENTO_PEDIDO,
    fallback: '—',
    resolver: ({ contexto }) => (contexto ? formatDinero(contexto.total) : null),
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_PEDIDO,
    valor: 'estatus',
    grupo: 'PEDIDO',
    label: 'Estatus',
    ejemplo: 'Listo para entrega',
    restriccion: SOLO_EVENTO_PEDIDO,
    fallback: '—',
    resolver: ({ contexto }) => {
      if (!contexto) return null;
      return contexto.origen === 'ORDER'
        ? (ESTADO_PEDIDO_LABEL as Record<string, string>)[contexto.estatus]
        : (PEDIDO_B2B_ESTADO_LABEL as Record<string, string>)[contexto.estatus];
    },
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_PEDIDO,
    valor: 'fechaHora',
    grupo: 'PEDIDO',
    label: 'Fecha y hora del pedido',
    ejemplo: '24 sep, 12:30',
    restriccion: SOLO_EVENTO_PEDIDO,
    fallback: '—',
    resolver: ({ contexto }) => (contexto ? formatFechaHoraCorta(contexto.createdAt) : null),
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_PEDIDO,
    valor: 'resumenProductos',
    grupo: 'PEDIDO',
    label: 'Resumen de productos',
    ejemplo: '2x Concha, 1x Café americano y 3 más',
    restriccion: SOLO_EVENTO_PEDIDO,
    fallback: '—',
    resolver: ({ contexto }) => (contexto ? resumenProductos(contexto.items) : null),
  },

  // --- Pedido, solo menudeo (Order) ---
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_PEDIDO,
    valor: 'tipoEntrega',
    grupo: 'PEDIDO',
    label: 'Tipo de entrega',
    ejemplo: 'Recoger en tienda / Envío a domicilio',
    restriccion: SOLO_EVENTO_PEDIDO_MENUDEO,
    fallback: '—',
    resolver: ({ contexto }) =>
      contexto?.origen === 'ORDER' ? (METODO_ENTREGA_LABEL as Record<string, string>)[contexto.metodoEntrega] : null,
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_PEDIDO,
    valor: 'direccionEntrega',
    grupo: 'PEDIDO',
    label: 'Dirección de entrega',
    ejemplo: 'Av. Patria 123, Jardines',
    restriccion: SOLO_EVENTO_PEDIDO_MENUDEO,
    fallback: '—',
    resolver: ({ contexto }) => {
      if (contexto?.origen !== 'ORDER') return null;
      // RECOGER no tiene dirección que mostrar — no es un dato faltante, es
      // el valor correcto para ese caso (ver tabla de la especificación).
      if (contexto.metodoEntrega === 'RECOGER') return 'Recoger en tienda';
      return direccionEntrega(contexto);
    },
  },
  {
    fuente: ReglaPlantillaVariableFuente.CAMPO_PEDIDO,
    valor: 'metodoPago',
    grupo: 'PEDIDO',
    label: 'Método de pago',
    ejemplo: 'Efectivo / Transferencia / Tarjeta',
    restriccion: SOLO_EVENTO_PEDIDO_MENUDEO,
    fallback: '—',
    resolver: ({ contexto }) =>
      contexto?.origen === 'ORDER' ? (METODO_PAGO_LABEL as Record<string, string>)[contexto.metodoPago] : null,
  },

  // --- Negocio (todos los triggers) ---
  {
    fuente: ReglaPlantillaVariableFuente.NOMBRE_NEGOCIO,
    valor: 'nombre',
    grupo: 'NEGOCIO',
    label: 'Nombre del negocio',
    ejemplo: 'Masa Madre',
    restriccion: SIN_RESTRICCION,
    fallback: '—',
    resolver: ({ tenant }) => tenant.nombre,
  },
  {
    fuente: ReglaPlantillaVariableFuente.NOMBRE_NEGOCIO,
    valor: 'link',
    grupo: 'NEGOCIO',
    label: 'Link de la tienda',
    ejemplo: 'pide.aelika.com/masa-madre',
    restriccion: SIN_RESTRICCION,
    fallback: '—',
    resolver: ({ storefrontUrl }) => storefrontUrl,
  },
  {
    fuente: ReglaPlantillaVariableFuente.NOMBRE_NEGOCIO,
    valor: 'ubicacion',
    grupo: 'NEGOCIO',
    label: 'Ubicación del negocio',
    ejemplo: 'Chapultepec 45',
    restriccion: SIN_RESTRICCION,
    fallback: '—',
    resolver: ({ tenant }) => tenant.ubicacion,
  },
];

export function buscarEnCatalogo(fuente: ReglaPlantillaVariableFuente, valor: string): CatalogoVariableDef | undefined {
  return CATALOGO_VARIABLES.find((def) => def.fuente === fuente && def.valor === valor);
}

/** ¿Se puede guardar esta variable en una Regla con este trigger/origen? (validación al crear/editar, sin pedido real todavía). */
export function disponibleParaTrigger(
  restriccion: RestriccionVariable,
  trigger: ReglaTriggerTipo,
  origen: ReglaTriggerOrigenPedido | undefined,
): boolean {
  if (restriccion.tipo === 'ninguna') return true;
  if (trigger !== ReglaTriggerTipo.EVENTO_PEDIDO) return false;
  if (restriccion.tipo === 'evento_pedido') return true;
  return origen === ReglaTriggerOrigenPedido.ORDER;
}

/** ¿Se puede resolver esta variable con el contexto de pedido real disponible al momento de enviar? */
export function disponibleParaContexto(restriccion: RestriccionVariable, contexto: PedidoContexto | undefined): boolean {
  if (restriccion.tipo === 'ninguna') return true;
  if (!contexto) return false;
  if (restriccion.tipo === 'evento_pedido') return true;
  return contexto.origen === 'ORDER';
}
