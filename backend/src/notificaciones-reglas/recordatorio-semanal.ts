import { BadRequestException } from '@nestjs/common';
import { Cliente } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DIAS_SEMANA, diaActualMexico, type DiaSemana } from '../common/horario';
import { sumarDiasISO } from '../pedidos-b2b/pedidos-b2b-logica';
import { semanasDelHorizonte } from '../portal/portal-calendario';
import { horaCdmx } from './reserva-trigger';

/**
 * Trigger RECORDATORIO_SEMANAL_PEDIDO (solo negocios RETAIL_B2B): recuerda por WhatsApp a los clientes B2B que hagan su
 * pedido de la SEMANA SIGUIENTE si todavía no lo han hecho. Lógica pura de programación y semana, más la consulta de
 * destinatarios. Todo en hora de CDMX (America/Mexico_City, vía Intl), nunca la zona del servidor.
 *
 *  - triggerConfig: { diaSemana: 'lunes'…'domingo', hora: 0–23 }. Se evalúa en cada barrido ese día desde esa hora hasta el
 *    fin del día CDMX (una regla activada tarde ese día aún envía ese día; nunca al día siguiente).
 *  - Semana siguiente = la siguiente a la semana en curso (lunes–domingo). Es exactamente la segunda semana del calendario
 *    del portal (`semanasDelHorizonte`), no una segunda definición.
 *  - Destinatarios: clientes B2B activos con teléfono principal válido (10 dígitos) sin ningún pedido B2B no cancelado de esa
 *    semana, y a quienes esta regla no les ha enviado ya por esa semana (cualquier registro, incluido FALLO).
 */
export interface TriggerConfigRecordatorio {
  diaSemana: DiaSemana;
  hora: number;
}

export interface SemanaSiguiente {
  /** Lunes, "YYYY-MM-DD". */
  inicio: string;
  /** Domingo, "YYYY-MM-DD". */
  fin: string;
}

type Obj = Record<string, unknown>;
const esObjeto = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const TELEFONO_VALIDO = /^\d{10}$/;

export function validarTriggerConfigRecordatorio(raw: unknown): TriggerConfigRecordatorio {
  if (!esObjeto(raw)) {
    throw new BadRequestException('triggerConfig inválido para RECORDATORIO_SEMANAL_PEDIDO: se espera { diaSemana, hora }');
  }
  const extra = Object.keys(raw).filter((k) => k !== 'diaSemana' && k !== 'hora');
  if (extra.length > 0) {
    throw new BadRequestException(`triggerConfig inválido para RECORDATORIO_SEMANAL_PEDIDO: campo no permitido "${extra[0]}"`);
  }
  if (typeof raw.diaSemana !== 'string' || !(DIAS_SEMANA as readonly string[]).includes(raw.diaSemana)) {
    throw new BadRequestException(`diaSemana debe ser uno de: ${DIAS_SEMANA.join(', ')}`);
  }
  if (typeof raw.hora !== 'number' || !Number.isInteger(raw.hora) || raw.hora < 0 || raw.hora > 23) {
    throw new BadRequestException('La hora debe ser un entero de 0 a 23 (hora de CDMX)');
  }
  return { diaSemana: raw.diaSemana as DiaSemana, hora: raw.hora };
}

/** ¿Toca evaluar la regla en este momento? Ese día de la semana (CDMX), desde su hora hasta el fin del día. */
export function ventanaActivaRecordatorio(config: TriggerConfigRecordatorio, ahora: Date): boolean {
  return diaActualMexico(ahora) === config.diaSemana && horaCdmx(ahora) >= config.hora;
}

/** Lunes y domingo de la semana siguiente a la semana en curso (CDMX): la segunda semana del calendario del portal. */
export function semanaSiguiente(ahora: Date): SemanaSiguiente {
  const inicio = semanasDelHorizonte(ahora, 1)[1];
  return { inicio, fin: sumarDiasISO(inicio, 6) };
}

/** Fecha de calendario como las columnas @db.Date (UTC a medianoche). */
export const fechaDeSemana = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

export interface DestinatariosRecordatorio {
  /** Clientes activos con teléfono principal válido: lo que la regla evalúa. */
  evaluados: number;
  /** Ya tienen un pedido B2B no cancelado de la semana siguiente. */
  omitidosPorPedido: number;
  /** Ya recibieron esta regla por esa semana (EN_CURSO, EXITO o FALLO). */
  yaEnviados: number;
  /** A quienes toca enviar ahora. */
  pendientes: Cliente[];
}

/**
 * Calcula a quién toca enviar (sin enviar). Un pedido cancelado no cuenta como pedido hecho. Un cliente de baja, sin
 * teléfono principal o con un teléfono que no es de 10 dígitos no se evalúa.
 */
export async function destinatariosRecordatorio(
  prisma: PrismaService,
  tenantId: string,
  reglaId: string,
  semana: SemanaSiguiente,
): Promise<DestinatariosRecordatorio> {
  const activos = await prisma.cliente.findMany({
    where: { tenantId, canal: 'B2B', bajaAt: null },
    include: { telefonos: { where: { principal: true }, select: { telefono: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const validos = activos
    .filter((c) => TELEFONO_VALIDO.test(c.telefonos[0]?.telefono ?? ''))
    .map(({ telefonos: _telefonos, ...cliente }) => cliente as Cliente);
  const ids = validos.map((c) => c.id);
  if (ids.length === 0) return { evaluados: 0, omitidosPorPedido: 0, yaEnviados: 0, pendientes: [] };

  const lunes = fechaDeSemana(semana.inicio);
  const [conPedido, yaEnviados] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, tipo: 'B2B', cancelado: false, clienteId: { in: ids }, detalleB2b: { is: { semanaInicio: lunes } } },
      select: { clienteId: true },
    }),
    prisma.reglaEnvioLog.findMany({
      where: { reglaId, semanaInicio: lunes, clienteId: { in: ids } },
      select: { clienteId: true },
    }),
  ]);
  const idsConPedido = new Set(conPedido.map((o) => o.clienteId));
  const idsYaEnviados = new Set(yaEnviados.map((l) => l.clienteId));

  // Con pedido y ya enviado a la vez (pidió después del primer aviso) cuenta como omitido por pedido: el segundo aviso no sale.
  const pendientes = validos.filter((c) => !idsConPedido.has(c.id) && !idsYaEnviados.has(c.id));
  return {
    evaluados: validos.length,
    omitidosPorPedido: validos.filter((c) => idsConPedido.has(c.id)).length,
    yaEnviados: validos.filter((c) => !idsConPedido.has(c.id) && idsYaEnviados.has(c.id)).length,
    pendientes,
  };
}
