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
 *  4. (solo flujo por API, `cancelacionRecalcula`) El total de un pedido CANCELADO solo cuenta entregas no canceladas: p5
 *     pasa de $450 a $0. En el flujo "filas legacy → migración" NO aplica: la migración de la Etapa 2 conserva el total
 *     histórico ($450) y el recálculo lo hace el script de datos b2b-estados (`--totales-cancelados`).
 */
const CAMPOS_NUEVOS = ['pagadoAt', 'entregas', 'entregaId', 'entregaEstado', 'cerradaAt', 'atrasada', 'enProceso'];

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

/** Lleva la respuesta RECIBIDA a la forma del golden. */
export function adaptarAlDorado(nombre: string, recibido: Dorado, op: OpcionesExcepciones): Dorado {
  if (recibido.texto) {
    const texto = recibido.texto.map((l) => {
      let linea = l.replace(',COMPLETADO,', ',DESPACHADO,'); // (1)
      if (op.cancelacionRecalcula && /^5,/.test(linea) && linea.endsWith(',10,0.00')) linea = linea.replace(/,10,0\.00$/, ',10,450.00'); // (4)
      return linea;
    });
    return { ...recibido, texto };
  }
  if (recibido.body === undefined) return recibido;
  let body = recibido.body;
  const esDia = nombre.startsWith('dia ') && !nombre.startsWith('dia export') && Array.isArray(body);
  if (esDia) {
    body = body.filter((r: any) => r.entregaEstado === 'PENDIENTE' || r.entregaEstado === 'LISTA'); // (3)
    body = body.map(({ cancelado: _c, ...r }: any) => r); // (2): `cancelado` por fila es nuevo en /dia
  }
  body = recorrer(body, (o) => {
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

/** El golden de una consulta, ajustado SOLO donde la excepción (4) cambia QUÉ filas devuelve (no solo un valor). */
export function ajustarDorado(nombre: string, dorado: Dorado, op: OpcionesExcepciones): Dorado {
  if (op.cancelacionRecalcula && nombre === 'lista?importe entre') {
    // p5 (cancelado, $450 en el golden) ya no cae en el rango 300–545 porque ahora vale $0.
    const data = dorado.body.data.filter((r: any) => r.folio !== '5');
    const quitadas = dorado.body.data.length - data.length;
    return { ...dorado, body: { ...dorado.body, data, total: dorado.body.total - quitadas } };
  }
  return dorado;
}
