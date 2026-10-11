import { EstadoEntrega, EstadoPedido } from '../../generated/prisma/client';
import {
  DIAS_EN_ORDEN,
  fechaMexicoYMD,
  sumarDiasISO,
} from '../pedidos-b2b/pedidos-b2b-logica';

/**
 * Calendario del portal del cliente B2B (Fase 4, 4c): lógica PURA (sin base de datos ni reloj propio) de qué puede hacer
 * un cliente con cada día de entrega. Fuente de verdad del backend; el frontend solo lo muestra.
 *
 * Reglas (docs/diseno-operacion.md, "Reglas de pedido"), todo en hora de Ciudad de México:
 *  - El instante de entrega de un día es esa fecha a la hora de entrega del negocio.
 *  - Crear o agregar un día: la entrega debe quedar a >= horasAgregar de ahora (el borde exacto es válido).
 *  - Modificar o quitar una entrega existente: a >= horasModificar de ahora (borde válido).
 *  - Horizonte: la semana en curso (lunes–domingo) y `horizonteSemanas` semanas después.
 *  - Pedido Pagado: todo su semana queda CERRADO (agregar un día también modifica el pedido pagado).
 */

export const ZONA_HORARIA = 'America/Mexico_City';

export type EstadoDiaPortal =
  'NO_DISPONIBLE' | 'AGREGABLE' | 'MODIFICABLE' | 'CERRADO';
export type MotivoDiaPortal =
  | 'PASADO'
  | 'ANTICIPACION_AGREGAR'
  | 'ANTICIPACION_MODIFICAR'
  | 'ENTREGA_CERRADA'
  | 'PEDIDO_PAGADO';
export type AccionDiaPortal = 'CREAR_PEDIDO' | 'AGREGAR_A_PEDIDO';

export interface ParametrosCalendario {
  /** "HH:mm". */
  horaEntrega: string;
  horasAgregar: number;
  horasModificar: number;
  horizonteSemanas: number;
}

/** Pedido no cancelado del cliente en una semana, lo mínimo que necesita el cálculo. */
export interface PedidoSemanaCalendario {
  folio: string;
  estadoPedido: EstadoPedido;
  pagado: boolean;
  entregas: { fecha: string; estado: EstadoEntrega }[];
}

export interface DiaCalendario {
  fecha: string;
  diaSemana: string;
  /** Instante de entrega (ISO UTC). */
  entregaAt: string;
  estado: EstadoDiaPortal;
  motivo: MotivoDiaPortal | null;
  /** Última hora a la que todavía se puede (agregar/modificar) o a la que dejó de poderse; null si no aplica. */
  limiteAt: string | null;
  accion: AccionDiaPortal | null;
  /** Estado de la entrega del cliente ese día, si tiene una. */
  entrega: { estado: EstadoEntrega } | null;
}

export interface SemanaCalendario {
  semanaInicio: string;
  semanaFin: string;
  esActual: boolean;
  pedido: {
    folio: string;
    estado: EstadoPedido;
    pagado: boolean;
    activo: boolean;
  } | null;
  /** true si no tiene pedido esa semana y al menos un día se puede agregar (crear un pedido nuevo). */
  puedeCrear: boolean;
  dias: DiaCalendario[];
}

const ESTADOS_ENTREGA_CERRADAS: EstadoEntrega[] = [
  EstadoEntrega.ENTREGADA,
  EstadoEntrega.NO_RECOGIDA,
  EstadoEntrega.CANCELADA,
];

const ESTADOS_PEDIDO_ACTIVOS: EstadoPedido[] = [
  EstadoPedido.PENDIENTE_CONFIRMACION,
  EstadoPedido.CONFIRMADO_SURTIENDO,
  EstadoPedido.EN_PROCESO,
];

export function pedidoEstaActivo(estado: EstadoPedido): boolean {
  return ESTADOS_PEDIDO_ACTIVOS.includes(estado);
}

const HORA_MS = 60 * 60 * 1000;

/** Diferencia (ms) entre el reloj de pared de la zona y UTC en ese instante. */
function desfaseZonaMs(instante: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);
  const n = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value);
  const comoUtc = Date.UTC(
    n('year'),
    n('month') - 1,
    n('day'),
    n('hour'),
    n('minute'),
    n('second'),
  );
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/** Instante (UTC) en que el reloj de pared de Ciudad de México marca esa fecha y hora. IANA vía Intl, sin offsets fijos. */
export function instanteEnMexico(fechaISO: string, hora: string): Date {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const pared = Date.UTC(y, m - 1, d, hh, mm);
  let candidato = pared;
  for (let i = 0; i < 3; i += 1) {
    const siguiente = pared - desfaseZonaMs(new Date(candidato));
    if (siguiente === candidato) break;
    candidato = siguiente;
  }
  return new Date(candidato);
}

/** Lunes (YYYY-MM-DD) de la semana que contiene la fecha. */
export function lunesDeFecha(fechaISO: string): string {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return sumarDiasISO(fechaISO, -((dow + 6) % 7));
}

/** Lunes de las semanas dentro del horizonte, empezando por la semana en curso. */
export function semanasDelHorizonte(
  ahora: Date,
  horizonteSemanas: number,
): string[] {
  const actual = lunesDeFecha(fechaMexicoYMD(ahora));
  return Array.from({ length: horizonteSemanas + 1 }, (_, i) =>
    sumarDiasISO(actual, 7 * i),
  );
}

function iso(d: Date): string {
  return d.toISOString();
}

function calcularDia(
  fecha: string,
  indice: number,
  ahora: Date,
  p: ParametrosCalendario,
  pedido: PedidoSemanaCalendario | null,
): DiaCalendario {
  const entregaAt = instanteEnMexico(fecha, p.horaEntrega);
  const limiteAgregar = new Date(
    entregaAt.getTime() - p.horasAgregar * HORA_MS,
  );
  const limiteModificar = new Date(
    entregaAt.getTime() - p.horasModificar * HORA_MS,
  );
  const entrega = pedido?.entregas.find((e) => e.fecha === fecha) ?? null;
  const base = {
    fecha,
    diaSemana: DIAS_EN_ORDEN[indice],
    entregaAt: iso(entregaAt),
    entrega: entrega ? { estado: entrega.estado } : null,
  };

  // Pedido Pagado: el cliente no lo modifica (ni quita ni agrega días): toda su semana queda cerrada.
  if (pedido?.pagado) {
    return {
      ...base,
      estado: 'CERRADO',
      motivo: 'PEDIDO_PAGADO',
      limiteAt: null,
      accion: null,
    };
  }

  if (entrega) {
    if (ESTADOS_ENTREGA_CERRADAS.includes(entrega.estado)) {
      return {
        ...base,
        estado: 'CERRADO',
        motivo: 'ENTREGA_CERRADA',
        limiteAt: null,
        accion: null,
      };
    }
    // PENDIENTE o LISTA (una entrega Lista sigue siendo editable).
    if (entregaAt.getTime() >= ahora.getTime() + p.horasModificar * HORA_MS) {
      return {
        ...base,
        estado: 'MODIFICABLE',
        motivo: null,
        limiteAt: iso(limiteModificar),
        accion: null,
      };
    }
    return {
      ...base,
      estado: 'CERRADO',
      motivo: 'ANTICIPACION_MODIFICAR',
      limiteAt: iso(limiteModificar),
      accion: null,
    };
  }

  if (entregaAt.getTime() < ahora.getTime()) {
    return {
      ...base,
      estado: 'NO_DISPONIBLE',
      motivo: 'PASADO',
      limiteAt: null,
      accion: null,
    };
  }
  if (entregaAt.getTime() >= ahora.getTime() + p.horasAgregar * HORA_MS) {
    return {
      ...base,
      estado: 'AGREGABLE',
      motivo: null,
      limiteAt: iso(limiteAgregar),
      accion: pedido ? 'AGREGAR_A_PEDIDO' : 'CREAR_PEDIDO',
    };
  }
  return {
    ...base,
    estado: 'NO_DISPONIBLE',
    motivo: 'ANTICIPACION_AGREGAR',
    limiteAt: iso(limiteAgregar),
    accion: null,
  };
}

export function calcularCalendario(
  ahora: Date,
  p: ParametrosCalendario,
  pedidosPorSemana: Map<string, PedidoSemanaCalendario>,
): SemanaCalendario[] {
  const semanas = semanasDelHorizonte(ahora, p.horizonteSemanas);
  return semanas.map((semanaInicio, i) => {
    const pedido = pedidosPorSemana.get(semanaInicio) ?? null;
    const dias = DIAS_EN_ORDEN.map((_, idx) =>
      calcularDia(sumarDiasISO(semanaInicio, idx), idx, ahora, p, pedido),
    );
    return {
      semanaInicio,
      semanaFin: sumarDiasISO(semanaInicio, 6),
      esActual: i === 0,
      pedido: pedido
        ? {
            folio: pedido.folio,
            estado: pedido.estadoPedido,
            pagado: pedido.pagado,
            activo: pedidoEstaActivo(pedido.estadoPedido),
          }
        : null,
      puedeCrear: !pedido && dias.some((d) => d.estado === 'AGREGABLE'),
      dias,
    };
  });
}
