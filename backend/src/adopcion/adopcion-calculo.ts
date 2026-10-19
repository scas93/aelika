import {
  fechaMexicoYMD,
  sumarDiasISO,
} from '../pedidos-b2b/pedidos-b2b-logica';

/**
 * Cálculos puros del módulo Adopción (solo lectura). Sin acceso a datos: reciben filas ya leídas, para poder probarlos
 * sin base. Todas las fechas de calendario son "YYYY-MM-DD" en America/Mexico_City; las semanas van de lunes a domingo.
 */

export const SEMANAS_HISTORIAL = 4;
/** Ventana de «últimas 4 semanas» de los tiempos del tab Interno. */
export const DIAS_VENTANA = SEMANAS_HISTORIAL * 7;

/** Lunes (YYYY-MM-DD) de la semana que contiene a `ymd`. */
export function lunesDe(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7; // lunes = 0
  return sumarDiasISO(ymd, -offset);
}

export function esLunes(ymd: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(ymd) &&
    !Number.isNaN(new Date(`${ymd}T00:00:00.000Z`).getTime()) &&
    new Date(`${ymd}T00:00:00.000Z`).getUTCDay() === 1
  );
}

/** Lunes de la semana en curso y de la próxima, en hora de Ciudad de México. */
export function semanasReferencia(ahora = new Date()) {
  const hoy = fechaMexicoYMD(ahora);
  const enCurso = lunesDe(hoy);
  return { hoy, enCurso, proxima: sumarDiasISO(enCurso, 7) };
}

/** Los 4 lunes anteriores a la semana seleccionada (de más reciente a más antigua). */
export function semanasAnteriores(seleccionada: string): string[] {
  return Array.from({ length: SEMANAS_HISTORIAL }, (_, i) =>
    sumarDiasISO(seleccionada, -7 * (i + 1)),
  );
}

export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2
    ? orden[mitad]
    : (orden[mitad - 1] + orden[mitad]) / 2;
}

export function redondear(n: number, decimales = 1): number {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------- Clientes

export type EstadoSemana =
  | 'PIDIO'
  | 'SIN_CONFIRMAR'
  | 'CANCELADO'
  | 'NO_HA_PEDIDO_HABITUAL'
  | 'NO_HA_PEDIDO';

export type EtapaActivacion =
  'SIN_ACTIVIDAD' | 'ACCEDIO' | 'HIZO_PEDIDO' | 'PIDE_CON_REGULARIDAD';

/** Pedido ya reducido a lo que necesitan las cuentas de adopción. */
export interface PedidoResumen {
  clienteId: string;
  semana: string; // lunes YYYY-MM-DD
  cancelado: boolean;
  porConfirmar: boolean; // estadoPedido = PENDIENTE_CONFIRMACION
}

export const UMBRAL_HABITUAL = 2;
export const UMBRAL_REGULAR = 3;

/** Semanas (de las dadas) en las que el cliente tiene un pedido NO cancelado. */
export function semanasConPedido(
  pedidos: PedidoResumen[],
  semanas: string[],
): number {
  const set = new Set(semanas);
  return new Set(
    pedidos
      .filter((p) => !p.cancelado && set.has(p.semana))
      .map((p) => p.semana),
  ).size;
}

/**
 * Estado del cliente en la semana seleccionada. Un cancelado que vuelve a pedir esa semana cuenta como «Pidió» (el
 * pedido cancelado no cuenta). «Habitual» = pidió (sin cancelar) en al menos 2 de las 4 semanas anteriores.
 */
export function estadoEnSemana(
  pedidosCliente: PedidoResumen[],
  seleccionada: string,
): EstadoSemana {
  const enSemana = pedidosCliente.filter((p) => p.semana === seleccionada);
  const vigentes = enSemana.filter((p) => !p.cancelado);
  if (vigentes.length > 0)
    return vigentes.some((p) => p.porConfirmar) ? 'SIN_CONFIRMAR' : 'PIDIO';
  if (enSemana.length > 0) return 'CANCELADO';
  return semanasConPedido(pedidosCliente, semanasAnteriores(seleccionada)) >=
    UMBRAL_HABITUAL
    ? 'NO_HA_PEDIDO_HABITUAL'
    : 'NO_HA_PEDIDO';
}

/** La etapa más alta alcanzada (sin exigir las anteriores). */
export function etapaActivacion(p: {
  pedidosCliente: PedidoResumen[];
  seleccionada: string;
  tienePedidoAlgunaVez: boolean;
  ultimoAccesoAt: Date | null;
}): EtapaActivacion {
  if (
    semanasConPedido(p.pedidosCliente, semanasAnteriores(p.seleccionada)) >=
    UMBRAL_REGULAR
  )
    return 'PIDE_CON_REGULARIDAD';
  if (p.tienePedidoAlgunaVez) return 'HIZO_PEDIDO';
  if (p.ultimoAccesoAt) return 'ACCEDIO';
  return 'SIN_ACTIVIDAD';
}

export interface OrigenConteo {
  portal: number;
  panel: number;
}

/** Porcentajes sobre pedidos CON dato de origen; `casos` = cuántos se midieron. Sin casos → null (no se asume nada). */
export function resumenOrigen(c: OrigenConteo) {
  const casos = c.portal + c.panel;
  return {
    casos,
    portal: c.portal,
    panel: c.panel,
    porcentajePortal: casos ? redondear((c.portal / casos) * 100) : null,
    porcentajePanel: casos ? redondear((c.panel / casos) * 100) : null,
  };
}

// ---------------------------------------------------------------- Interno

/** Horas entre recibido y confirmado: solo con fecha de confirmación válida (nunca negativas). */
export function horasRecibidoAConfirmado(
  pares: { creadoAt: Date; confirmadoAt: Date | null }[],
) {
  const horas = pares
    .filter((p) => p.confirmadoAt)
    .map((p) => (p.confirmadoAt!.getTime() - p.creadoAt.getTime()) / 3_600_000)
    .filter((h) => h >= 0);
  return {
    casos: horas.length,
    medianaHoras: horas.length ? redondear(mediana(horas)!) : null,
    maximoHoras: horas.length ? redondear(Math.max(...horas)) : null,
  };
}

/**
 * Puntualidad de entregas ENTREGADAS: «a tiempo» = cerradas el día programado (o antes), «después» = otro día posterior,
 * comparando la fecha de calendario de `estadoCambiadoAt` en hora de Ciudad de México. Sin esa fecha no se mide.
 */
export function puntualidadEntregas(
  entregas: { fecha: Date; estadoCambiadoAt: Date | null }[],
) {
  let aTiempo = 0;
  let despues = 0;
  let sinDato = 0;
  for (const e of entregas) {
    if (!e.estadoCambiadoAt) {
      sinDato++;
      continue;
    }
    const programada = e.fecha.toISOString().slice(0, 10);
    if (fechaMexicoYMD(e.estadoCambiadoAt) <= programada) aTiempo++;
    else despues++;
  }
  const casos = aTiempo + despues;
  return {
    casos,
    aTiempo,
    despues,
    sinDato,
    porcentajeATiempo: casos ? redondear((aTiempo / casos) * 100) : null,
  };
}
