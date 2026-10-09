import request from 'supertest';
import { expectError, expectExacto } from './exacto';
import { usarSuite } from './helpers';
import { crearEscenarioB2b, EscenarioB2b } from './escenario-b2b';
import { apiRol, diaEsperado, entregaEsperada, etiquetasB2b, itemB2bEsperado, pedidoB2bEsperado } from './b2b-helpers';

// 0b-1 · Área 6 · Panel B2B: lista + filtros, CSV y exports, entregas del día, resumen, entregas-resumen, findOne.
// Respuestas exactas; valores exactos en los resúmenes. Los empates de `semanaInicio` no tienen orden
// contractual: se comparan ordenados por (semana desc, folio asc).

type Fila = {
  folio: string; negocioNombre: string; contactoNombre: string; semanaInicio: string; estado: string;
  estadoPago: string; modoCobro: string; cancelado: boolean; totalPiezas: number; total: string; createdAt: string;
};
const fila = (
  folio: string, negocioNombre: string, contactoNombre: string, semana: string, estado: string, estadoPago: string,
  modoCobro: string, cancelado: boolean, totalPiezas: number, total: string, createdAt: string,
): Fila => ({ folio, negocioNombre, contactoNombre, semanaInicio: `${semana}T00:00:00.000Z`, estado, estadoPago, modoCobro, cancelado, totalPiezas, total, createdAt });

const FILAS: Record<string, Fila> = {
  '1': fila('1', 'Abarrotes Uno', 'Uno', '2026-09-14', 'COMPLETADO', 'PAGADO', 'AL_FINAL', false, 12, '540', '2026-09-10T15:00:00.000Z'),
  '2': fila('2', 'Bodega Dos', 'Dos', '2026-09-28', 'CONFIRMADO_SURTIENDO', 'PENDIENTE', 'AL_FINAL', false, 12, '540', '2026-09-25T15:00:00.000Z'),
  '3': fila('3', 'Cafetería Tres', 'Tres', '2026-09-28', 'PENDIENTE_CONFIRMACION', 'PENDIENTE', 'AL_FINAL', false, 10, '305', '2026-09-26T15:00:00.000Z'),
  '4': fila('4', 'Deli Cuatro', 'Cuatro', '2026-10-05', 'PENDIENTE_CONFIRMACION', 'PENDIENTE', 'AL_FINAL', false, 15, '542.25', '2026-09-28T15:00:00.000Z'),
  '5': fila('5', 'Express Cinco', 'Cinco', '2026-10-05', 'PENDIENTE_CONFIRMACION', 'PENDIENTE', 'AL_FINAL', true, 10, '0', '2026-09-29T15:00:00.000Z'),
  '6': fila('6', 'Fonda Seis', 'Seis', '2026-10-12', 'CONFIRMADO_SURTIENDO', 'PAGADO', 'AL_INICIO', false, 20, '900', '2026-09-29T17:00:00.000Z'),
};
const ordenar = <T extends { semanaInicio: string; folio: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.semanaInicio === b.semanaInicio ? Number(a.folio) - Number(b.folio) : a.semanaInicio < b.semanaInicio ? 1 : -1));
const filas = (...folios: string[]) => ordenar(folios.map((f) => FILAS[f]));

describe('B2B · panel', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  let e: EscenarioB2b;
  const api = () => apiRol(s.h, s.base, 'DUENO');

  beforeEach(async () => {
    e = await crearEscenarioB2b(s);
  });

  async function lista(qs = '') {
    const res = await api().get(`/pedidos-b2b${qs ? `?${qs}` : ''}`).expect(200);
    const rows = res.body.data.map(({ id, ...r }: any) => r);
    // orden contractual: semanaInicio descendente
    const semanas = rows.map((r: any) => r.semanaInicio);
    expect([...semanas].sort().reverse()).toStrictEqual(semanas);
    return { body: res.body, rows: ordenar(rows) };
  }

  describe('GET /pedidos-b2b', () => {
    it('forma paginada exacta, columnas exactas por fila y orden por semana desc', async () => {
      const { body, rows } = await lista();
      expect(Object.keys(body).sort()).toStrictEqual(['data', 'limit', 'page', 'total', 'totalPages']);
      expect({ total: body.total, page: body.page, limit: body.limit, totalPages: body.totalPages }).toStrictEqual({ total: 6, page: 1, limit: 25, totalPages: 1 });
      expect(body.data.map((r: any) => Object.keys(r).sort())).toStrictEqual(
        Array(6).fill(['cancelado', 'contactoNombre', 'createdAt', 'estado', 'estadoPago', 'folio', 'id', 'modoCobro', 'negocioNombre', 'semanaInicio', 'total', 'totalPiezas']),
      );
      expect(rows).toStrictEqual(filas('1', '2', '3', '4', '5', '6'));
    });

    it('filtros: estado, cancelado, negocio (parcial e insensible), semana (desde/hasta) e importe', async () => {
      expect((await lista('estado=PENDIENTE_CONFIRMACION')).rows).toStrictEqual(filas('3', '4', '5'));
      expect((await lista('estado=CONFIRMADO_SURTIENDO')).rows).toStrictEqual(filas('2', '6'));
      expect((await lista('estado=COMPLETADO')).rows).toStrictEqual(filas('1'));
      expect((await lista('estado=DESPACHADO')).rows).toStrictEqual(filas('1')); // alias heredado: abarca COMPLETADO
      expect((await lista('estado=EN_PROCESO')).rows).toStrictEqual([]);
      expect((await lista('cancelado=true')).rows).toStrictEqual(filas('5'));
      expect((await lista('cancelado=false')).rows).toStrictEqual(filas('1', '2', '3', '4', '6'));
      expect((await lista('negocioNombre=UNO')).rows).toStrictEqual(filas('1'));
      expect((await lista('negocioNombre=de')).rows).toStrictEqual(filas('2', '4')); // "Bodega Dos" y "Deli Cuatro" contienen "de"
    });

    it('filtros de semana e importe', async () => {
      expect((await lista('desde=2026-09-28&hasta=2026-10-05')).rows).toStrictEqual(filas('2', '3', '4', '5'));
      expect((await lista('operador=MAYOR_IGUAL&valor=540')).rows).toStrictEqual(filas('1', '2', '4', '6'));
      expect((await lista('operador=ENTRE&valor=300&valorHasta=450')).rows).toStrictEqual(filas('3')); // p5 cancelado ahora vale 0
      expect((await lista('estado=PENDIENTE_CONFIRMACION&cancelado=false&operador=MENOR_IGUAL&valor=400')).rows).toStrictEqual(filas('3'));
    });

    it('paginación: total, páginas y filas únicas por posición', async () => {
      const primera = await lista('limit=1&page=1');
      expect({ total: primera.body.total, page: primera.body.page, limit: primera.body.limit, totalPages: primera.body.totalPages }).toStrictEqual({ total: 6, page: 1, limit: 1, totalPages: 6 });
      expect(primera.rows).toStrictEqual(filas('6')); // la semana más reciente
      expect((await lista('limit=1&page=6')).rows).toStrictEqual(filas('1')); // la más antigua
    });

    it('validación: limit > 100, estado inválido', async () => {
      expectError(await api().get('/pedidos-b2b?limit=101'), 400, ['limit must not be greater than 100']);
      expectError(await api().get('/pedidos-b2b?estado=NOPE'), 400, [
        'estado must be one of the following values: PENDIENTE_CONFIRMACION, CONFIRMADO_SURTIENDO, EN_PROCESO, COMPLETADO, DESPACHADO',
      ]);
    });
  });

  describe('GET /pedidos-b2b/export (CSV)', () => {
    const CAB = '﻿Folio,Negocio,Contacto,Semana,Estado,Modo de cobro,Estado de pago,Cancelado,Piezas,Total';
    const csv = async (qs = '') => {
      const res = await api().get(`/pedidos-b2b/export${qs ? `?${qs}` : ''}`).expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="pedidos-b2b.csv"');
      const [cabecera, ...rows] = res.text.split('\r\n');
      expect(cabecera).toBe(CAB);
      return rows.sort();
    };
    const R: Record<string, string> = {
      '1': '1,Abarrotes Uno,Uno,2026-09-14,COMPLETADO,AL_FINAL,PAGADO,No,12,540.00',
      '2': '2,Bodega Dos,Dos,2026-09-28,CONFIRMADO_SURTIENDO,AL_FINAL,PENDIENTE,No,12,540.00',
      '3': '3,Cafetería Tres,Tres,2026-09-28,PENDIENTE_CONFIRMACION,AL_FINAL,PENDIENTE,No,10,305.00',
      '4': '4,Deli Cuatro,Cuatro,2026-10-05,PENDIENTE_CONFIRMACION,AL_FINAL,PENDIENTE,No,15,542.25',
      '5': '5,Express Cinco,Cinco,2026-10-05,PENDIENTE_CONFIRMACION,AL_FINAL,PENDIENTE,Sí,10,0.00',
      '6': '6,Fonda Seis,Seis,2026-10-12,CONFIRMADO_SURTIENDO,AL_INICIO,PAGADO,No,20,900.00',
    };
    const esperado = (...f: string[]) => f.map((x) => R[x]).sort();

    it('todas las filas: CRLF, BOM, orden de columnas y montos con 2 decimales', async () => {
      expect(await csv()).toStrictEqual(esperado('1', '2', '3', '4', '5', '6'));
    });

    it('filtros: estado, estados (varios valores separados por coma), cancelado, negocio, fechas', async () => {
      expect(await csv('estado=COMPLETADO')).toStrictEqual(esperado('1'));
      expect(await csv('estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO&cancelado=false')).toStrictEqual(esperado('2', '3', '4', '6'));
      expect(await csv('estados=DESPACHADO')).toStrictEqual(esperado('1')); // alias heredado: abarca COMPLETADO
      expect(await csv('cancelado=true')).toStrictEqual(esperado('5'));
      expect(await csv('negocioNombre=cuatro')).toStrictEqual(esperado('4'));
      expect(await csv('desde=2026-10-05&hasta=2026-10-12')).toStrictEqual(esperado('4', '5', '6'));
    });

    it('estados tiene prioridad sobre estado si llegan ambos', async () => {
      expect(await csv('estado=COMPLETADO&estados=CONFIRMADO_SURTIENDO')).toStrictEqual(esperado('2', '6'));
    });

    it('validación: estados con un valor inválido', async () => {
      expectError(await api().get('/pedidos-b2b/export?estados=NOPE'), 400, [
        'each value in estados must be one of the following values: PENDIENTE_CONFIRMACION, CONFIRMADO_SURTIENDO, EN_PROCESO, COMPLETADO, DESPACHADO',
      ]);
    });
  });

  describe('GET /pedidos-b2b/dia/:fecha (entregas del día)', () => {
    // Cada fila lleva ahora su entrega (estado, cierre, atrasada) y `cancelado` del pedido; `entregaId` se quita en sinId.
    const entrega = (
      folio: string, negocio: string, contacto: string, tel: string, estado: string, items: unknown[],
      ent: Record<string, unknown> = {},
    ) => ({
      folio, negocioNombre: negocio, contactoNombre: contacto, contactoTelefono: tel, estado, cancelado: false,
      entregaEstado: 'PENDIENTE', cerradaAt: null, atrasada: false, ...ent, items,
    });
    const it_ = (productId: string, nombre: string, precio: string, cantidad: number) => ({ productId, nombreProducto: nombre, precioUnitario: precio, cantidad });
    const sinId = (body: any[]) => body.map(({ id, entregaId, ...r }: any) => r);

    it('miércoles: los pedidos activos con algo ese día, items recortados a ese día, ordenados por negocio', async () => {
      const res = await api().get('/pedidos-b2b/dia/2026-09-30').expect(200);
      expect(res.body.map((r: any) => Object.keys(r).sort())).toStrictEqual(
        Array(2).fill(['atrasada', 'cancelado', 'cerradaAt', 'contactoNombre', 'contactoTelefono', 'entregaEstado', 'entregaId', 'estado', 'folio', 'id', 'items', 'negocioNombre']),
      );
      expect(sinId(res.body)).toStrictEqual([
        entrega('2', 'Bodega Dos', 'Dos', '5511000002', 'CONFIRMADO_SURTIENDO', [it_(s.base.productoA.id, 'Café americano', '45', 6)]),
        entrega('3', 'Cafetería Tres', 'Tres', '5511000003', 'PENDIENTE_CONFIRMACION', [it_(s.base.productoB.id, 'Concha', '30.5', 10)]),
      ]);
    });

    it('otros días: lunes (solo p2, ya pasado y pendiente → atrasada), lunes de la semana próxima (p4; p5 cancelado no aparece), martes vacío', async () => {
      expect(sinId((await api().get('/pedidos-b2b/dia/2026-09-28').expect(200)).body)).toStrictEqual([
        entrega('2', 'Bodega Dos', 'Dos', '5511000002', 'CONFIRMADO_SURTIENDO', [it_(s.base.productoA.id, 'Café americano', '45', 6)], { atrasada: true }),
      ]);
      expect(sinId((await api().get('/pedidos-b2b/dia/2026-10-05').expect(200)).body)).toStrictEqual([
        entrega('4', 'Deli Cuatro', 'Cuatro', '5511000004', 'PENDIENTE_CONFIRMACION', [it_(s.base.productoA.id, 'Café americano', '45', 10)]),
      ]);
      expect((await api().get('/pedidos-b2b/dia/2026-09-29').expect(200)).body).toStrictEqual([]);
    });

    it('incluye las entregas cerradas (con su estado) y no las canceladas', async () => {
      // p1 (COMPLETADO): su entrega del lunes 09-14 quedó Entregada y SIGUE apareciendo, con su estado y la hora del cierre.
      const [p1] = (await api().get('/pedidos-b2b/dia/2026-09-14').expect(200)).body;
      expect({ folio: p1.folio, estado: p1.estado, entregaEstado: p1.entregaEstado, atrasada: p1.atrasada, cerrada: p1.cerradaAt !== null }).toStrictEqual({
        folio: '1',
        estado: 'COMPLETADO',
        entregaEstado: 'ENTREGADA',
        atrasada: false,
        cerrada: true,
      });
      // p5 (cancelado, todas sus entregas CANCELADAS) no aparece el lunes 10-05 (solo p4)
      expect((await api().get('/pedidos-b2b/dia/2026-10-05').expect(200)).body.map((r: any) => r.folio)).toStrictEqual(['4']);
    });

    it('fecha inválida: 400', async () => {
      expectError(await api().get('/pedidos-b2b/dia/nope'), 400, '"fecha" no es una fecha válida');
    });

    it('CSV del día: cabeceras, CRLF/BOM y filas (una por producto)', async () => {
      const res = await api().get('/pedidos-b2b/dia/2026-09-30/export').expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="pedidos-b2b-dia.csv"');
      expect(res.text).toMatchSnapshot();
    });
  });

  describe('GET /pedidos-b2b/resumen', () => {
    it('valores exactos (semana en curso, próxima semana, ranking)', async () => {
      const res = await api().get('/pedidos-b2b/resumen').expect(200);
      const sorted = (arr: any[]) => [...arr].sort((a, b) => Number(a.folio) - Number(b.folio));
      const { semanaEnCurso, ...resto } = res.body;
      const { entregasHoy, entregasManana, pendientesMasAntiguos, ...enCurso } = semanaEnCurso;
      expect(Object.keys(res.body).sort()).toStrictEqual(['proximaSemana', 'rankingProductos', 'semanaEnCurso']);
      expect(enCurso).toStrictEqual({
        inicio: '2026-09-28',
        fin: '2026-10-04',
        pendientesConfirmacion: 1,
        confirmadosSurtiendo: 1,
        enProceso: 0,
        totalPiezas: 22,
      });
      // sin orden contractual en entregas de hoy
      expect(sorted(entregasHoy)).toStrictEqual([
        { folio: '2', negocioNombre: 'Bodega Dos', cantidad: 6 },
        { folio: '3', negocioNombre: 'Cafetería Tres', cantidad: 10 },
      ]);
      expect(entregasManana).toStrictEqual([]);
      // los más antiguos primero; solo pendientes no cancelados de cualquier semana
      expect(pendientesMasAntiguos).toStrictEqual([
        { id: e.ids.p3, folio: '3', negocioNombre: 'Cafetería Tres', diasPendiente: 4 },
        { id: e.ids.p4, folio: '4', negocioNombre: 'Deli Cuatro', diasPendiente: 2 },
      ]);
      expect(resto).toStrictEqual({
        proximaSemana: { inicio: '2026-10-05', fin: '2026-10-11', totalPedidos: 1, totalPiezas: 15 },
        rankingProductos: [
          { nombreProducto: 'Café americano', cantidadTotal: 22 },
          { nombreProducto: 'Concha', cantidadTotal: 15 },
        ],
      });
    });

    it('sin pedidos: ceros y listas vacías (forma exacta)', async () => {
      await s.h.prisma.order.deleteMany({ where: { tipo: 'B2B' } });
      const res = await api().get('/pedidos-b2b/resumen').expect(200);
      expect(res.body).toStrictEqual({
        semanaEnCurso: {
          inicio: '2026-09-28',
          fin: '2026-10-04',
          pendientesConfirmacion: 0,
          confirmadosSurtiendo: 0,
          enProceso: 0,
          totalPiezas: 0,
          entregasHoy: [],
          entregasManana: [],
          pendientesMasAntiguos: [],
        },
        proximaSemana: { inicio: '2026-10-05', fin: '2026-10-11', totalPedidos: 0, totalPiezas: 0 },
        rankingProductos: [],
      });
    });
  });

  describe('GET /pedidos-b2b/:id', () => {
    it('pedido con código: forma exacta con items, distribución y codigoDescuento', async () => {
      const res = await api().get(`/pedidos-b2b/${e.ids.p4}`).expect(200);
      expectExacto(
        res.body,
        pedidoB2bEsperado({
          folio: '4',
          negocioNombre: 'Deli Cuatro',
          contactoNombre: 'Cuatro',
          contactoTelefono: '5511000004',
          contactoCorreo: 'cuatro@negocio.test',
          totalPiezas: 15,
          codigoDescuentoId: '<codigo>',
          codigoDescuentoTexto: 'PROMO10',
          descuentoPorcentajeAplicado: '10',
          subtotal: '602.5',
          descuentoTotal: '60.25',
          total: '542.25',
          items: [
            itemB2bEsperado({ cantidadTotal: 10, distribucion: [diaEsperado('LUNES', 10, 0)] }, 0),
            itemB2bEsperado(
              { productId: '<productoB>', nombreProducto: 'Concha', precioUnitario: '30.5', cantidadTotal: 5, distribucion: [diaEsperado('JUEVES', 5, 1)] },
              1,
            ),
          ],
          entregas: [entregaEsperada('LUNES'), entregaEsperada('JUEVES')],
          pagadoAt: null, // Fase 1b: fecha y hora del pago (solo en la forma del panel)
          codigoDescuento: {
            id: '<codigo>',
            tenantId: '<tenant>',
            codigo: 'PROMO10',
            descuentoPorcentaje: '10',
            activo: true,
            usosMaximos: null,
            fechaLimite: null,
            createdAt: '<iso>',
            updatedAt: '<iso>',
          },
        }),
        etiquetasB2b(s.base, res.body, { [e.codigoId]: 'codigo' }),
      );
    });

    it('pedido sin código: codigoDescuento es null', async () => {
      const res = await api().get(`/pedidos-b2b/${e.ids.p3}`).expect(200);
      expectExacto(
        res.body,
        pedidoB2bEsperado({
          folio: '3',
          negocioNombre: 'Cafetería Tres',
          contactoNombre: 'Tres',
          contactoTelefono: '5511000003',
          contactoCorreo: 'tres@negocio.test',
          totalPiezas: 10,
          subtotal: '305',
          total: '305',
          items: [
            itemB2bEsperado(
              { productId: '<productoB>', nombreProducto: 'Concha', precioUnitario: '30.5', cantidadTotal: 10, distribucion: [diaEsperado('MIERCOLES', 10, 0)] },
              0,
            ),
          ],
          entregas: [entregaEsperada('MIERCOLES')],
          pagadoAt: null,
          codigoDescuento: null,
        }),
        etiquetasB2b(s.base, res.body),
      );
    });

    it('cancelado y pagado se reflejan en la forma completa', async () => {
      const cancelado = (await api().get(`/pedidos-b2b/${e.ids.p5}`).expect(200)).body;
      expect({ cancelado: cancelado.cancelado, canceladoAt: cancelado.canceladoAt, estado: cancelado.estado }).toStrictEqual({
        cancelado: true,
        canceladoAt: '2026-09-29T15:00:00.000Z',
        estado: 'PENDIENTE_CONFIRMACION', // cancelar no toca `estado`
      });
      const pagado = (await api().get(`/pedidos-b2b/${e.ids.p6}`).expect(200)).body;
      expect({ estado: pagado.estado, estadoPago: pagado.estadoPago, modoCobro: pagado.modoCobro }).toStrictEqual({
        estado: 'CONFIRMADO_SURTIENDO',
        estadoPago: 'PAGADO',
        modoCobro: 'AL_INICIO',
      });
    });

    it('id inexistente: 404', async () => {
      expectError(await api().get('/pedidos-b2b/00000000-0000-4000-8000-000000000000'), 404, 'Pedido no encontrado');
    });

    it('sin token: 401', async () => {
      expectError(await request(s.h.app.getHttpServer()).get(`/pedidos-b2b/${e.ids.p1}`), 401, 'Unauthorized');
    });
  });
});
