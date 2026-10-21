import ExcelJS from 'exceljs';
import { usarSuite } from './helpers';
import { apiRol, cerrarEntregasB2b, crearAdminB2b, SEMANA_ACTUAL, SEMANA_PASADA, SEMANA_PROXIMA } from './b2b-helpers';

// Históricos lista TODOS los pedidos B2B (también los de la semana actual y la siguiente, en cualquier estado y pago); su Excel
// exporta lo mismo que la pantalla. Pedidos activos no cambia: sigue pidiendo por semana y por estado.
describe('B2B · Históricos incluye pedidos activos', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  let ids: { pasado: string; actual: string; siguiente: string };

  beforeEach(async () => {
    const pasado = await crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_PASADA, negocioNombre: 'Negocio Pasado', contactoTelefono: '5500000001' });
    await dueno().patch(`/pedidos-b2b/${pasado.id}/avanzar`).expect(200);
    await cerrarEntregasB2b(dueno(), pasado.id); // Completado
    await dueno().patch(`/pedidos-b2b/${pasado.id}/marcar-pagado`).expect(200);
    const actual = await crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_ACTUAL, negocioNombre: 'Negocio Actual', contactoTelefono: '5500000002' });
    await dueno().patch(`/pedidos-b2b/${actual.id}/avanzar`).expect(200); // Confirmado
    const siguiente = await crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_PROXIMA, negocioNombre: 'Negocio Siguiente', contactoTelefono: '5500000003' }); // Por confirmar
    ids = { pasado: pasado.id, actual: actual.id, siguiente: siguiente.id };
  });

  // La pantalla de Históricos consulta sin soloHistorico: estos son sus parámetros.
  const historico = async (qs = '') =>
    ((await dueno().get(`/pedidos-b2b?page=1&limit=25${qs}`).expect(200)).body as { data: { id: string; negocioNombre: string }[]; total: number });
  const idsDe = (r: { data: { id: string }[] }) => r.data.map((x) => x.id).sort();

  it('lista el pedido pasado, el de la semana actual y el de la siguiente, en cualquier estado y pago', async () => {
    const r = await historico();
    expect(r.total).toBe(3);
    expect(idsDe(r)).toStrictEqual([ids.pasado, ids.actual, ids.siguiente].sort());
    const porId = Object.fromEntries((r.data as unknown as { id: string; estado: string; estadoPago: string }[]).map((x) => [x.id, x]));
    expect(porId[ids.pasado]).toMatchObject({ estado: 'COMPLETADO', estadoPago: 'PAGADO' });
    expect(porId[ids.actual]).toMatchObject({ estado: 'CONFIRMADO_SURTIENDO', estadoPago: 'PENDIENTE' });
    expect(porId[ids.siguiente]).toMatchObject({ estado: 'PENDIENTE_CONFIRMACION', estadoPago: 'PENDIENTE' });
  });

  it('orden y paginación sobre el conjunto ampliado: semana más reciente primero', async () => {
    const pagina1 = await dueno().get('/pedidos-b2b?page=1&limit=2').expect(200);
    expect(pagina1.body.total).toBe(3);
    expect(pagina1.body.totalPages).toBe(2);
    expect(pagina1.body.data.map((x: { id: string }) => x.id)).toStrictEqual([ids.siguiente, ids.actual]);
    const pagina2 = await dueno().get('/pedidos-b2b?page=2&limit=2').expect(200);
    expect(pagina2.body.data.map((x: { id: string }) => x.id)).toStrictEqual([ids.pasado]);
  });

  it('los filtros aplican sobre todos: estado, pago, negocio, semana y cancelado', async () => {
    expect(idsDe(await historico('&estado=PENDIENTE_CONFIRMACION&cancelado=false'))).toStrictEqual([ids.siguiente]);
    expect(idsDe(await historico('&estado=CONFIRMADO_SURTIENDO&cancelado=false'))).toStrictEqual([ids.actual]);
    expect(idsDe(await historico('&estado=COMPLETADO&cancelado=false'))).toStrictEqual([ids.pasado]);
    expect(idsDe(await historico('&estadoPago=PENDIENTE'))).toStrictEqual([ids.actual, ids.siguiente].sort());
    expect(idsDe(await historico('&estadoPago=PAGADO'))).toStrictEqual([ids.pasado]);
    expect(idsDe(await historico('&negocioNombre=siguiente'))).toStrictEqual([ids.siguiente]);
    expect(idsDe(await historico(`&desde=${SEMANA_ACTUAL}&hasta=${SEMANA_ACTUAL}`))).toStrictEqual([ids.actual]);
    expect(idsDe(await historico('&cancelado=true'))).toStrictEqual([]);
    await dueno().patch(`/pedidos-b2b/${ids.siguiente}/cancelar`).expect(200);
    expect(idsDe(await historico('&cancelado=true'))).toStrictEqual([ids.siguiente]);
  });

  it('el Excel de Históricos exporta lo mismo que la pantalla (incluidos los activos) y respeta los filtros', async () => {
    const descargar = async (qs: string) => {
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
      return libro;
    };
    const negocios = (libro: ExcelJS.Workbook) => {
      const hoja = libro.getWorksheet('Pedidos')!;
      const out: string[] = [];
      hoja.eachRow((row, n) => n > 1 && out.push(String(row.getCell(1).value)));
      return out.sort();
    };
    const todos = await descargar('');
    expect(negocios(todos)).toStrictEqual(['Negocio Actual', 'Negocio Pasado', 'Negocio Siguiente']);
    // Mismas columnas de siempre en Históricos (empieza por Negocio, sin Folio).
    expect((todos.getWorksheet('Pedidos')!.getRow(1).values as string[]).slice(1, 3)).toStrictEqual(['Negocio', 'Semana (inicio)']);
    expect(negocios(await descargar('&estado=PENDIENTE_CONFIRMACION&cancelado=false'))).toStrictEqual(['Negocio Siguiente']);
    expect(negocios(await descargar('&estadoPago=PAGADO'))).toStrictEqual(['Negocio Pasado']);
    expect(negocios(await descargar('&negocioNombre=actual'))).toStrictEqual(['Negocio Actual']);
  });

  it('Pedidos activos NO cambia: sigue pidiendo por semana y estado (solo la semana consultada y solo activos)', async () => {
    const activos = (semana: string) =>
      `estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false&desde=${semana}&hasta=${semana}`;
    expect(idsDe(await historico(`&${activos(SEMANA_ACTUAL)}`))).toStrictEqual([ids.actual]);
    expect(idsDe(await historico(`&${activos(SEMANA_PROXIMA)}`))).toStrictEqual([ids.siguiente]);
    expect(idsDe(await historico(`&${activos(SEMANA_PASADA)}`))).toStrictEqual([]); // el Completado pasado no es activo
    // «De semanas anteriores»: activos con semana anterior a la actual (aquí, ninguno).
    expect(idsDe(await historico(`&estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false&semanaAntesDe=${SEMANA_ACTUAL}`))).toStrictEqual([]);
    // El parámetro soloHistorico sigue existiendo en la API (ya no lo usa la pantalla de Históricos).
    expect(idsDe(await historico('&soloHistorico=true'))).toStrictEqual([ids.pasado]);
  });
});
