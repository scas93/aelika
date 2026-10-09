import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { apiRol } from './b2b-helpers';
import { EscenarioB2b } from './escenario-b2b';
import { normalizar } from './normalizar';
import { Suite } from './helpers';

/**
 * Etapa 2 · dorados. Captura la salida HTTP COMPLETA del módulo B2B (y los "detectores de fuga" B2C) sobre el
 * escenario p1..p6 (escenario-b2b.ts), ya normalizada (ids → etiquetas estables, fechas → <iso>), más el volcado de
 * las filas legacy (pedidos_b2b*) que la migración de datos debe poder reproducir.
 *
 * Se generó UNA vez contra el código previo a la Etapa 2 (`ETAPA2_ESCRIBIR_DORADOS=1`) y se versiona en
 * `__dorados__/etapa2-b2b.json`. Después se usa en modo verificación contra:
 *   · el flujo por API (el código nuevo crea el escenario y las respuestas deben ser idénticas), y
 *   · el flujo migrado (filas legacy → migración → mismas respuestas).
 * Un cambio permitido se documenta en la lista de excepciones del spec, nunca regenerando el archivo.
 */

export const RANGO =
  'desde=2026-09-30T06:00:00.000Z&hasta=2026-10-01T05:59:59.999Z';

const FECHAS_DIA: string[] = (() => {
  const out: string[] = [];
  const d = new Date('2026-09-14T00:00:00.000Z');
  for (let i = 0; i < 35; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
})();

interface Consulta {
  nombre: string;
  url: string;
  /** Cuerpo CSV: se compara como texto (cabecera + filas). */
  csv?: boolean;
  /** Las filas con empate de semana no tienen orden contractual: se ordenan antes de congelar. */
  ordenar?: 'lista' | 'filasCsv';
  publica?: boolean;
}

export function consultasDorado(slug: string, ids: string[]): Consulta[] {
  const q: Consulta[] = [
    { nombre: 'lista', url: '/pedidos-b2b', ordenar: 'lista' },
    {
      nombre: 'lista?estado=CONFIRMADO',
      url: '/pedidos-b2b?estado=CONFIRMADO_SURTIENDO',
      ordenar: 'lista',
    },
    {
      nombre: 'lista?estados+cancelado=false',
      url: '/pedidos-b2b?estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO&cancelado=false',
      ordenar: 'lista',
    },
    {
      nombre: 'lista?cancelado=true',
      url: '/pedidos-b2b?cancelado=true',
      ordenar: 'lista',
    },
    {
      nombre: 'lista?negocio=dos',
      url: '/pedidos-b2b?negocioNombre=dos',
      ordenar: 'lista',
    },
    {
      nombre: 'lista?semanas',
      url: '/pedidos-b2b?desde=2026-09-28&hasta=2026-10-05',
      ordenar: 'lista',
    },
    {
      nombre: 'lista?importe>=540',
      url: '/pedidos-b2b?operador=MAYOR_IGUAL&valor=540',
      ordenar: 'lista',
    },
    {
      nombre: 'lista?importe entre',
      url: '/pedidos-b2b?operador=ENTRE&valor=300&valorHasta=545',
      ordenar: 'lista',
    },
    {
      nombre: 'export',
      url: '/pedidos-b2b/export',
      csv: true,
      ordenar: 'filasCsv',
    },
    {
      nombre: 'export?estados',
      url: '/pedidos-b2b/export?estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO&cancelado=false',
      csv: true,
      ordenar: 'filasCsv',
    },
    { nombre: 'resumen', url: '/pedidos-b2b/resumen' },
    ...ids.map((id, i) => ({
      nombre: `detalle p${i + 1}`,
      url: `/pedidos-b2b/${id}`,
    })),
    ...FECHAS_DIA.map((f) => ({
      nombre: `dia ${f}`,
      url: `/pedidos-b2b/dia/${f}`,
    })),
    ...['2026-09-28', '2026-09-30', '2026-10-05', '2026-10-12'].map((f) => ({
      nombre: `dia export ${f}`,
      url: `/pedidos-b2b/dia/${f}/export`,
      csv: true,
    })),
    { nombre: 'codigos', url: '/codigos-descuento-b2b' },
    {
      nombre: 'clientes',
      url: '/clientes?limit=100&ordenarPor=ultimoPedidoAt&orden=asc',
    },
    { nombre: 'clientes activos', url: '/clientes/activos' },
    {
      nombre: 'clientes summary/daily',
      url: `/clientes/summary/daily?${RANGO}`,
    },
    // Detectores de fuga: el panel B2C no debe ver nada de B2B ni antes ni después de la Etapa 2.
    { nombre: 'B2C /orders', url: '/orders' },
    { nombre: 'B2C /orders?soloPagados', url: '/orders?soloPagados=true' },
    { nombre: 'B2C summary', url: `/orders/summary?${RANGO}` },
    { nombre: 'B2C summary/daily', url: `/orders/summary/daily?${RANGO}` },
    { nombre: 'B2C summary/estatus', url: `/orders/summary/estatus?${RANGO}` },
    { nombre: 'B2C historico', url: '/orders/historico', csv: false },
    {
      nombre: 'B2C historico/export',
      url: '/orders/historico/export',
      csv: true,
    },
    {
      nombre: 'pública info',
      url: `/public/pedidos-b2b/tenants/${slug}`,
      publica: true,
    },
    {
      nombre: 'pública catálogo',
      url: `/public/pedidos-b2b/tenants/${slug}/catalog`,
      publica: true,
    },
    {
      nombre: 'pública código',
      url: `/public/pedidos-b2b/tenants/${slug}/codigos-descuento/promo10`,
      publica: true,
    },
  ];
  return q;
}

type Dorado = { status: number; body?: unknown; texto?: string[] };

function ordenarLista(body: any) {
  const data = [...body.data].sort((a: any, b: any) =>
    a.semanaInicio === b.semanaInicio
      ? Number(String(a.folio).replace(/^P-/, '')) -
        Number(String(b.folio).replace(/^P-/, ''))
      : a.semanaInicio < b.semanaInicio
        ? 1
        : -1,
  );
  return { ...body, data };
}

/** Etiquetas estables: tenant, productos, pedidos, clientes, items y días (por posición en el detalle del pedido). */
export function etiquetasDorado(
  s: Suite,
  detalles: any[],
  codigoId: string,
): Record<string, string> {
  const et: Record<string, string> = {
    [s.base.tenant.id]: 'tenant',
    [s.base.productoA.id]: 'productoA',
    [s.base.productoB.id]: 'productoB',
    [codigoId]: 'codigo',
  };
  detalles.forEach((p, i) => {
    const n = i + 1;
    et[p.id] = `p${n}`;
    et[p.clienteId] = `cliente_p${n}`;
    p.items.forEach((item: any, j: number) => {
      et[item.id] = `p${n}.i${j}`;
      item.distribucion.forEach(
        (d: any, k: number) => (et[d.id] = `p${n}.i${j}.d${k}`),
      );
    });
  });
  return et;
}

export async function capturar(
  s: Suite,
  e: EscenarioB2b,
): Promise<Record<string, Dorado>> {
  const dueno = apiRol(s.h, s.base, 'DUENO');
  const ids = Object.values(e.ids);
  const detalles = await Promise.all(
    ids.map(async (id) => (await dueno.get(`/pedidos-b2b/${id}`)).body),
  );
  const et = etiquetasDorado(s, detalles, e.codigoId);

  const out: Record<string, Dorado> = {};
  for (const c of consultasDorado(s.base.tenant.slug, ids)) {
    const res = c.publica
      ? await request(s.h.app.getHttpServer()).get(c.url)
      : await dueno.get(c.url);
    if (c.csv) {
      const [cab, ...filas] = res.text.split('\r\n');
      out[c.nombre] = {
        status: res.status,
        texto: [cab, ...(c.ordenar === 'filasCsv' ? [...filas].sort() : filas)],
      };
    } else {
      const body =
        c.ordenar === 'lista' && res.status === 200
          ? ordenarLista(res.body)
          : res.body;
      out[c.nombre] = { status: res.status, body: normalizar(body, et) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Volcado de las filas legacy (solo tablas pedidos_b2b*, clientes B2B y código). Ids reales, sin normalizar:
// es la entrada de la migración. tenantId/productId se sustituyen por los del seed de la prueba al cargarlo.
// ---------------------------------------------------------------------------

export interface VolcadoLegacy {
  codigos: any[];
  clientes: any[];
  pedidos: any[];
  items: any[];
  itemsDia: any[];
}

export async function volcarLegacy(
  prisma: PrismaService,
): Promise<VolcadoLegacy> {
  const j = (x: unknown) => JSON.parse(JSON.stringify(x));
  return {
    codigos: j(await prisma.pedidoB2bCodigoDescuento.findMany()),
    clientes: j(await prisma.cliente.findMany({ where: { canal: 'B2B' } })),
    pedidos: j(await prisma.pedidoB2b.findMany()),
    items: j(await prisma.pedidoB2bItem.findMany()),
    itemsDia: j(await prisma.pedidoB2bItemDia.findMany()),
  };
}

// ---------------------------------------------------------------------------
// Carga del volcado legacy en una base de prueba limpia (para probar la migración de datos).
// ---------------------------------------------------------------------------

export interface DoradosArchivo {
  tenantId: string;
  productoA: string;
  productoB: string;
  ids: Record<string, string>;
  codigoId: string;
  consultas: Record<
    string,
    { status: number; body?: unknown; texto?: string[] }
  >;
  legacy: VolcadoLegacy;
}

/**
 * Inserta las filas legacy del volcado (ids reales conservados) sustituyendo SOLO tenant y productos por los del
 * seed de la prueba. El orden de inserción es el del volcado, que es el orden físico original de los ítems.
 */
export async function cargarLegacy(
  prisma: PrismaService,
  s: Suite,
  d: DoradosArchivo,
): Promise<VolcadoLegacy> {
  const crudo = JSON.stringify(d.legacy)
    .split(d.tenantId)
    .join(s.base.tenant.id)
    .split(d.productoA)
    .join(s.base.productoA.id)
    .split(d.productoB)
    .join(s.base.productoB.id);
  const v: VolcadoLegacy = JSON.parse(crudo);
  await prisma.pedidoB2bCodigoDescuento.createMany({ data: v.codigos as any });
  // Fase 2: todo cliente B2B lleva código (CHECK en la base); los clientes legados del volcado se cargan con uno sintético.
  await prisma.cliente.createMany({
    data: v.clientes.map((c: any) =>
      c.canal === 'B2B' && !c.codigo
        ? { ...c, codigo: `legado-${String(c.id).slice(0, 8)}` }
        : c,
    ) as any,
  });
  await prisma.pedidoB2b.createMany({ data: v.pedidos as any });
  await prisma.pedidoB2bItem.createMany({ data: v.items as any });
  await prisma.pedidoB2bItemDia.createMany({ data: v.itemsDia as any });
  return v;
}
