import type { ModalidadPagoB2b } from "./api";

// Modalidades de cobro B2B. Los valores internos (AL_INICIO / AL_FINAL) no cambian; este es el ÚNICO mapa de nombres de la
// interfaz (alta y ficha del cliente, Ajustes → Pagos, panel del pedido, avisos).
export const MODALIDADES_COBRO: ModalidadPagoB2b[] = ["AL_FINAL", "AL_INICIO"];

export const MODALIDAD_LABEL: Record<ModalidadPagoB2b, string> = {
  AL_FINAL: "A crédito",
  AL_INICIO: "Pago por adelantado",
};

export const MODALIDAD_DESCRIPCION: Record<ModalidadPagoB2b, string> = {
  AL_FINAL: "Se entrega el pedido y se cobra después, por fuera de Aelika.",
  AL_INICIO: "El pedido se confirma cuando registras el pago.",
};

export const AVISO_ACTIVAR_MODALIDAD = "Actívala en Ajustes → Pagos";
export const AVISO_MODALIDAD_INACTIVA = "Esta modalidad ya no está activa en Ajustes → Pagos";

/** Con una sola modalidad activa se selecciona sola; con dos o más no hay selección por defecto. */
export function modalidadInicial(activas: ModalidadPagoB2b[]): "" | ModalidadPagoB2b {
  return activas.length === 1 ? activas[0] : "";
}
