/**
 * Excepciones DELIBERADAS a los dorados de la Etapa 2 (`__dorados__/etapa2-b2b.json`, generados con el código previo y que
 * NUNCA se regeneran). Los cambios de "estados B2B por entrega" (docs/diseno-operacion.md) alteran la salida HTTP en estos
 * puntos exactos y solo en estos; en vez de tocar el archivo, la respuesta recibida se lleva de vuelta a la forma antigua
 * con `adaptarAlDorado` — así todo lo demás se sigue comparando byte a byte contra el golden.
 *
 *  1. El estado `DESPACHADO` de B2B ahora se expone como `COMPLETADO` (despachar ya no existe).
 *  2. Campos NUEVOS que el golden no conoce: `entregas` (solo GET /:id), `enProceso` (resumen) y, en cada fila de
 *     /dia/:fecha, `entregaId`, `entregaEstado`, `cerradaAt`, `atrasada` y `cancelado`.
 *  2b. `pagadoAt` (fecha y hora del pago, Fase 1b): nuevo campo de la forma del panel (GET /:id), null mientras el pedido
 *      esté Pendiente de pago.
 *  3. Entregas del día: ahora incluyen las entregas CERRADAS (Entregada / No recogida) con su estado; el golden solo traía
 *     pedidos activos. Se descartan las filas con entrega cerrada (en el escenario solo p1, ya completado).
 *  5. (Fase 1b) `lista?estados=…` ahora filtra de verdad por `estados` (antes lo ignoraba): el Despachado p1 sale de esa consulta.
 *  4. (solo flujo por API, `cancelacionRecalcula`) El total de un pedido CANCELADO solo cuenta entregas no canceladas: p5
 *     pasa de $450 a $0. En el flujo "filas legacy → migración" NO aplica: la migración de la Etapa 2 conserva el total
 *     histórico ($450) y el recálculo lo hace el script de datos b2b-estados (`--totales-cancelados`).
 *  6. (Folio B2B nuevo) Los folios de pedidos B2B nuevos son "P-" + 6 dígitos (antes "1", "2"…). Se lleva de vuelta al consecutivo
 *     simple (P-000003 → 3) en el cuerpo, el CSV y los textos; el resto se sigue comparando byte a byte.
 *  7. (Módulos por negocio) `codigosDescuentoActivo`: campo NUEVO de la info pública del storefront de mayoreo (siempre true con
 *     todo encendido); el golden no lo conoce.
 *  8. (Fase 2, clientes B2B) En la lista de clientes (`/clientes`), la fila de un cliente B2B ya no trae `nombre` = nombre del contacto
 *     ni `telefono`: ahora es el nombre comercial del cliente y su teléfono vive en `ClienteTelefono` (Cliente.telefono = null). Esos dos
 *     campos se quitan de las filas B2B tanto del golden como de lo recibido; el resto de la fila se sigue comparando byte a byte.
 *  9. (Fase 2, panel lateral) `GET /pedidos-b2b/:id` suma `notaCliente` y `clienteCodigo` (el código actual del cliente): campos nuevos que el golden
 *     no conoce.
 */
const CAMPOS_NUEVOS = [
  'pagadoAt',
  'entregas',
  'entregaId',
  'entregaEstado',
  'cerradaAt',
  'atrasada',
  'enProceso',
  'codigosDescuentoActivo',
  'notaCliente',
  'clienteCodigo',
];

type Dorado = { status: number; body?: any; texto?: string[] };
export interface OpcionesExcepciones {
  cancelacionRecalcula: boolean;
}

function recorrer(valor: any, f: (o: any) => void): any {
  if (Array.isArray(valor)) return valor.map((v) => recorrer(v, f));
  if (valor && typeof valor === 'object') {
    const o: any = {};
    for (const [k, v] of Object.entries(valor)) o[k] = recorrer(v, f);
    f(o);
    return o;
  }
  return valor;
}

/** (8) Quita `nombre` y `telefono` de las filas de clientes B2B (ver arriba). */
function sinIdentidadB2b(nombre: string, d: Dorado): Dorado {
  if (nombre !== 'clientes' || !Array.isArray(d.body?.data)) return d;
  const data = d.body.data.map((c: any) => {
    if (c.canal !== 'B2B') return c;
    const resto = { ...c };
    delete resto.nombre;
    delete resto.telefono;
    return resto;
  });
  return { ...d, body: { ...d.body, data } };
}

/** Lleva la respuesta RECIBIDA a la forma del golden. */
export function adaptarAlDorado(
  nombre: string,
  recibido: Dorado,
  op: OpcionesExcepciones,
): Dorado {
  recibido = sinIdentidadB2b(nombre, recibido);
  if (recibido.texto) {
    const texto = recibido.texto.map((l) => {
      let linea = l
        .replace(',COMPLETADO,', ',DESPACHADO,')
        .replace(/\bP-0*(\d+)\b/g, '$1'); // (1) y (6)
      if (
        op.cancelacionRecalcula &&
        /^5,/.test(linea) &&
        linea.endsWith(',10,0.00')
      )
        linea = linea.replace(/,10,0\.00$/, ',10,450.00'); // (4)
      return linea;
    });
    return { ...recibido, texto };
  }
  if (recibido.body === undefined) return recibido;
  let body = recibido.body;
  const esDia =
    nombre.startsWith('dia ') &&
    !nombre.startsWith('dia export') &&
    Array.isArray(body);
  if (esDia) {
    body = body.filter(
      (r: any) =>
        r.entregaEstado === 'PENDIENTE' || r.entregaEstado === 'LISTA',
    ); // (3)
    body = body.map((r: any) => {
      const fila = { ...r };
      delete fila.cancelado;
      return fila;
    }); // (2): `cancelado` por fila es nuevo en /dia
  }
  body = recorrer(body, (o) => {
    if (typeof o.folio === 'string')
      o.folio = o.folio.replace(/^P-0*(\d+)$/, '$1'); // (6)
    if (o.estado === 'COMPLETADO') o.estado = 'DESPACHADO'; // (1)
    for (const campo of CAMPOS_NUEVOS) delete o[campo]; // (2)
    if (op.cancelacionRecalcula && o.folio === '5' && o.cancelado === true) {
      // (4): fila de lista (total) y detalle (subtotal/total)
      if (o.total === '0') o.total = '450';
      if (o.subtotal === '0') o.subtotal = '450';
    }
  });
  return { ...recibido, body };
}

/** El golden de una consulta, ajustado SOLO donde una excepción cambia QUÉ filas devuelve (no solo un valor). */
export function ajustarDorado(
  nombre: string,
  dorado: Dorado,
  op: OpcionesExcepciones,
): Dorado {
  dorado = sinIdentidadB2b(nombre, dorado);
  // (5) Fase 1b: GET /pedidos-b2b ahora respeta `estados=A,B` (antes el listado lo ignoraba y devolvía todos los no cancelados,
  // incluido el Despachado p1). Con los 3 estados activos, el Completado/Despachado ya no entra.
  if (nombre === 'lista?estados+cancelado=false') {
    const data = dorado.body.data.filter((r: any) => r.folio !== '1');
    return {
      ...dorado,
      body: {
        ...dorado.body,
        data,
        total: dorado.body.total - (dorado.body.data.length - data.length),
      },
    };
  }
  if (op.cancelacionRecalcula && nombre === 'lista?importe entre') {
    // p5 (cancelado, $450 en el golden) ya no cae en el rango 300–545 porque ahora vale $0.
    const data = dorado.body.data.filter((r: any) => r.folio !== '5');
    const quitadas = dorado.body.data.length - data.length;
    return {
      ...dorado,
      body: { ...dorado.body, data, total: dorado.body.total - quitadas },
    };
  }
  return dorado;
}
