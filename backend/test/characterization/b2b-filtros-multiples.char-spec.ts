import ExcelJS from 'exceljs';
import { usarSuite } from './helpers';
import { apiRol, cerrarEntregasB2b, crearAdminB2b, SEMANA_ACTUAL } from './b2b-helpers';

// Filtros de selección múltiple (Estado y Pago) de Pedidos activos e Históricos: O dentro de un filtro, Y entre filtros, vacío =
// todos, regla de «Cancelado» (indicador, no estado) y Excel igual al listado. Un solo valor en el formato de siempre sigue igual.
describe('B2B · filtros de selección múltiple (Estado y Pago)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  let n: Record<'porConfirmar' | 'confirmado' | 'enProceso' | 'completado' | 'canceladoEnProceso' | 'canceladoPorConfirmar', string>;

  beforeEach(async () => {
    const nuevo = (negocio: string, i: number) => crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_ACTUAL, negocioNombre: negocio, contactoTelefono: `55100000${i}` });
    const porConfirmar = await nuevo('Por Confirmar', 1);
    const confirmado = await nuevo('Confirmado', 2);
    await dueno().patch(`/pedidos-b2b/${confirmado.id}/avanzar`).expect(200);
    await dueno().patch(`/pedidos-b2b/${confirmado.id}/marcar-pagado`).expect(200); // Confirmado y pagado
    const enProceso = await nuevo('En Proceso', 3);
    await dueno().patch(`/pedidos-b2b/${enProceso.id}/avanzar`).expect(200);
    const e = (await dueno().get(`/pedidos-b2b/${enProceso.id}`)).body.entregas[0];
    await dueno().patch(`/pedidos-b2b/${enProceso.id}/entregas/${e.id}/cerrar`).send({ estado: 'ENTREGADA' }).expect(200);
    const completado = await nuevo('Completado', 4);
    await dueno().patch(`/pedidos-b2b/${completado.id}/avanzar`).expect(200);
    await cerrarEntregasB2b(dueno(), completado.id);
    await dueno().patch(`/pedidos-b2b/${completado.id}/marcar-pagado`).expect(200); // Completado y pagado
    // Cancelado estando En proceso: conserva su estado (En proceso) y además es cancelado.
    const canceladoEnProceso = await nuevo('Cancelado En Proceso', 5);
    await dueno().patch(`/pedidos-b2b/${canceladoEnProceso.id}/avanzar`).expect(200);
    const e2 = (await dueno().get(`/pedidos-b2b/${canceladoEnProceso.id}`)).body.entregas[0];
    await dueno().patch(`/pedidos-b2b/${canceladoEnProceso.id}/entregas/${e2.id}/cerrar`).send({ estado: 'ENTREGADA' }).expect(200);
    await dueno().patch(`/pedidos-b2b/${canceladoEnProceso.id}/cancelar`).expect(200);
    const canceladoPorConfirmar = await nuevo('Cancelado Por Confirmar', 6);
    await dueno().patch(`/pedidos-b2b/${canceladoPorConfirmar.id}/cancelar`).expect(200);
    n = {
      porConfirmar: porConfirmar.id,
      confirmado: confirmado.id,
      enProceso: enProceso.id,
      completado: completado.id,
      canceladoEnProceso: canceladoEnProceso.id,
      canceladoPorConfirmar: canceladoPorConfirmar.id,
    };
  });

  const listar = async (qs: string) => {
    const r = await dueno().get(`/pedidos-b2b?page=1&limit=100${qs}`).expect(200);
    return (r.body.data as { id: string }[]).map((x) => x.id);
  };
  const igual = (a: string[], b: string[]) => expect([...a].sort()).toStrictEqual([...b].sort());
  const todos = () => Object.values(n);

  it('el pedido cancelado estando En proceso conserva su estado y además está cancelado (premisa de las pruebas)', async () => {
    const r = await dueno().get(`/pedidos-b2b?page=1&limit=100&cancelado=true`).expect(200);
    const fila = (r.body.data as { id: string; estado: string; cancelado: boolean }[]).find((x) => x.id === n.canceladoEnProceso)!;
    expect(fila).toMatchObject({ estado: 'EN_PROCESO', cancelado: true });
  });

  describe('Estado de pago', () => {
    it('un valor, en el formato de siempre, funciona igual', async () => {
      igual(await listar('&estadoPago=PAGADO'), [n.confirmado, n.completado]);
      igual(await listar('&estadoPago=PENDIENTE'), [n.porConfirmar, n.enProceso, n.canceladoEnProceso, n.canceladoPorConfirmar]);
    });

    it('dos valores (O) y marcar todos equivale a no filtrar', async () => {
      igual(await listar('&estadoPago=PENDIENTE,PAGADO'), todos());
      igual(await listar('&estadoPago=PAGADO,PAGADO'), [n.confirmado, n.completado]);
      igual(await listar(''), todos());
    });

    it('un valor inválido da 400', async () => {
      expect((await dueno().get('/pedidos-b2b?estadoPago=PAGADO,XX')).status).toBe(400);
    });
  });

  describe('Estado', () => {
    it('dos estados (O): Por confirmar o Confirmado, solo no cancelados', async () => {
      igual(await listar('&estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO&cancelado=false'), [n.porConfirmar, n.confirmado]);
    });

    it('«Completado» + «Cancelado»: los Completados no cancelados MÁS todos los cancelados', async () => {
      igual(await listar('&estados=COMPLETADO&conCancelados=true'), [n.completado, n.canceladoEnProceso, n.canceladoPorConfirmar]);
    });

    it('«En proceso» + «Cancelado»: el cancelado estando en proceso cumple por dos vías y sale UNA sola vez', async () => {
      const ids = await listar('&estados=EN_PROCESO&conCancelados=true');
      igual(ids, [n.enProceso, n.canceladoEnProceso, n.canceladoPorConfirmar]);
      expect(ids.filter((id) => id === n.canceladoEnProceso)).toHaveLength(1);
      // Y el total/paginación cuentan una vez
      const r = await dueno().get('/pedidos-b2b?page=1&limit=2&estados=EN_PROCESO&conCancelados=true').expect(200);
      expect(r.body.total).toBe(3);
      expect(r.body.totalPages).toBe(2);
    });

    it('«Cancelado» solo y los estados sin «Cancelado» siguen como siempre', async () => {
      igual(await listar('&cancelado=true'), [n.canceladoEnProceso, n.canceladoPorConfirmar]);
      igual(await listar('&conCancelados=true'), [n.canceladoEnProceso, n.canceladoPorConfirmar]);
      igual(await listar('&estados=EN_PROCESO&cancelado=false'), [n.enProceso]); // el cancelado en proceso NO entra sin «Cancelado»
    });
  });

  it('Estado y Pago se combinan con Y', async () => {
    igual(await listar('&estados=CONFIRMADO_SURTIENDO,COMPLETADO&cancelado=false&estadoPago=PAGADO'), [n.confirmado, n.completado]);
    igual(await listar('&estados=CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false&estadoPago=PENDIENTE'), [n.enProceso]);
    igual(await listar('&estados=COMPLETADO&conCancelados=true&estadoPago=PENDIENTE'), [n.canceladoEnProceso, n.canceladoPorConfirmar]);
  });

  describe('Excel igual al listado', () => {
    const negociosExcel = async (qs: string) => {
      const res = await dueno()
        .get(`/pedidos-b2b/export-xlsx?vista=HISTORICOS${qs}`)
        .buffer(true)
        .parse((r, cb) => {
          const t: Buffer[] = [];
          r.on('data', (c: Buffer) => t.push(c));
          r.on('end', () => cb(null, Buffer.concat(t)));
        })
        .expect(200);
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.load(res.body);
      const out: string[] = [];
      libro.getWorksheet('Pedidos')!.eachRow((row, i) => i > 1 && out.push(String(row.getCell(1).value)));
      return out.sort();
    };
    const negociosLista = async (qs: string) => {
      const r = await dueno().get(`/pedidos-b2b?page=1&limit=100${qs}`).expect(200);
      return (r.body.data as { negocioNombre: string }[]).map((x) => x.negocioNombre).sort();
    };

    it.each([
      ['dos estados', '&estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO&cancelado=false'],
      ['Completado + Cancelado', '&estados=COMPLETADO&conCancelados=true'],
      ['En proceso + Cancelado (una sola vez)', '&estados=EN_PROCESO&conCancelados=true'],
      ['dos pagos', '&estadoPago=PENDIENTE,PAGADO'],
      ['un pago', '&estadoPago=PAGADO'],
      ['estado y pago combinados', '&estados=CONFIRMADO_SURTIENDO,COMPLETADO&cancelado=false&estadoPago=PAGADO'],
      ['sin filtros', ''],
    ])('%s', async (_nombre, qs) => {
      const excel = await negociosExcel(qs);
      expect(excel).toStrictEqual(await negociosLista(qs));
      expect(excel.length).toBeGreaterThan(0);
    });
  });
});
