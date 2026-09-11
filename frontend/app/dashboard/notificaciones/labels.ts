import type {
  ReglaFiltroCampo,
  ReglaFiltroOperador,
  ReglaMensajeCategoria,
  ReglaPlantillaVariableFuente,
  ReglaTriggerOrigenPedido,
  ReglaTriggerTipo,
} from "@/lib/api";
import { ESTADOS as ESTADOS_ORDER, ESTADO_LABEL as ESTADO_LABEL_ORDER } from "../pedidos/estado";
import { ESTADO_LABEL as ESTADO_LABEL_PEDIDO_B2B } from "../pedidos-b2b/estado";

// Todos los valores de EstadoPedido/PedidoB2bEstado, reusando los mismos
// labels ya definidos en pedidos/estado.ts y pedidos-b2b/estado.ts — no se
// duplican aquí, solo se reempaquetan por origen para el selector de
// EVENTO_PEDIDO (ver EventoPedidoFields). 3 valores para PEDIDO_B2B (sin
// LISTO_ENTREGA), 4 para ORDER — ver ReglaTriggerOrigenPedido en schema.prisma.
export const ESTATUS_POR_ORIGEN: Record<ReglaTriggerOrigenPedido, { value: string; label: string }[]> = {
  ORDER: ESTADOS_ORDER.map((value) => ({ value, label: ESTADO_LABEL_ORDER[value] })),
  PEDIDO_B2B: (Object.keys(ESTADO_LABEL_PEDIDO_B2B) as (keyof typeof ESTADO_LABEL_PEDIDO_B2B)[]).map((value) => ({
    value,
    label: ESTADO_LABEL_PEDIDO_B2B[value],
  })),
};

export const TRIGGER_LABEL: Record<ReglaTriggerTipo, string> = {
  EVENTO_PEDIDO: "Evento de pedido",
  ESTADO_CLIENTE: "Estado del cliente",
  FECHA_PROGRAMADA: "Fecha programada",
  MANUAL: "Manual",
};

// Reusa pares de acento ya existentes en nav-items.ts (mismo criterio que
// promotions-section.tsx: "reutilizar tonos ya establecidos en vez de
// inventar una paleta nueva por pantalla") — Pedidos/Clientes/Inicio/
// Catálogo, uno por tipo de Trigger.
export const TRIGGER_BADGE_COLOR: Record<ReglaTriggerTipo, string> = {
  EVENTO_PEDIDO: "bg-[#FEF3C7] text-[#B45309]",
  ESTADO_CLIENTE: "bg-[#FFE4E6] text-[#E11D48]",
  FECHA_PROGRAMADA: "bg-[#DBEAFE] text-[#3B82F6]",
  MANUAL: "bg-[#EDE9FE] text-[#8B5CF6]",
};

export const CATEGORIA_LABEL: Record<ReglaMensajeCategoria, string> = {
  UTILITY: "Utility",
  MARKETING: "Marketing",
};

export const CATEGORIA_BADGE_COLOR: Record<ReglaMensajeCategoria, string> = {
  UTILITY: "bg-[#DBEAFE] text-[#3B82F6]",
  MARKETING: "bg-[#FCE7F3] text-[#EC4899]",
};

export const ORIGEN_PEDIDO_LABEL: Record<ReglaTriggerOrigenPedido, string> = {
  ORDER: "Pedido (menudeo)",
  PEDIDO_B2B: "Pedido B2B (mayoreo)",
};

export const FILTRO_CAMPO_LABEL: Record<ReglaFiltroCampo, string> = {
  TOTAL_PEDIDOS: "Total de pedidos",
  ULTIMO_PEDIDO_ANTIGUEDAD_DIAS: "Antigüedad del último pedido (días)",
  PRIMER_PEDIDO_ANTIGUEDAD_DIAS: "Antigüedad del primer pedido (días)",
};

// IGUAL se filtra fuera del selector cuando el campo es de antigüedad — ver
// FiltroCondicionRow — el backend lo rechaza para esos dos campos.
export const FILTRO_OPERADOR_LABEL: Record<ReglaFiltroOperador, string> = {
  MAYOR_IGUAL: "es mayor o igual a",
  MENOR_IGUAL: "es menor o igual a",
  IGUAL: "es igual a",
};

export const VARIABLE_FUENTE_LABEL: Record<ReglaPlantillaVariableFuente, string> = {
  CAMPO_CLIENTE: "Campo cliente: nombre",
  VALOR_FIJO: "Valor fijo",
  CAMPO_PEDIDO: "Campo pedido: folio",
  // Resuelve Tenant.nombre — ver el enum en schema.prisma. Disponible para
  // cualquier Trigger, no solo EVENTO_PEDIDO como Campo pedido.
  NOMBRE_NEGOCIO: "Nombre del negocio",
};

// Catálogo fijo de los idiomas más comunes soportados por WhatsApp (Meta) —
// reemplaza el texto libre que tenía este campo. es_MX va primero porque es
// el único usado por todas las plantillas existentes hasta ahora.
export const IDIOMAS_PLANTILLA: { value: string; label: string }[] = [
  { value: "es_MX", label: "Español (México)" },
  { value: "es", label: "Español" },
  { value: "es_AR", label: "Español (Argentina)" },
  { value: "es_ES", label: "Español (España)" },
  { value: "en_US", label: "Inglés (EE. UU.)" },
  { value: "en", label: "Inglés" },
  { value: "pt_BR", label: "Portugués (Brasil)" },
];
