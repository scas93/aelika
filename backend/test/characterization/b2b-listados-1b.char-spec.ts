import { usarSuite } from './helpers';
import { apiRol, cerrarEntregasB2b, crearAdminB2b, SEMANA_ACTUAL, SEMANA_PASADA } from './b2b-helpers';

// Fase 1b — filtros del listado para Históricos (solo Completados y Cancelados) y para "De semanas anteriores" de Pedidos
// activos. El listado SIN esos parámetros conserva su contrato (devuelve todo).
describe('B2B · listados de Históricos y de Pedidos activos (Fase 1b)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  let ids: Record<'porConfirmarPasada' | 'enProcesoPasada' | 'completado' | 'cancelado' | 'confirmado', string>;

  beforeEach(async () => {
    const n = (i: number) => ({ contactoTelefono: `55000000${i}` });
    const porConfirmarPasada = await crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_PASADA, ...n(1) });
    const enProcesoPasada = await crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_PASADA, ...n(2) });
    await dueno().patch(`/pedidos-b2b/${enProcesoPasada.id}/avanzar`).expect(200);
    const e = (await dueno().get(`/pedidos-b2b/${enProcesoPasada.id}`)).body.entregas[0];
    await dueno().patch(`/pedidos-b2b/${enProcesoPasada.id}/entregas/${e.id}/cerrar`).send({ estado: 'ENTREGADA' }).expect(200);
    const completado = await crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_ACTUAL, ...n(3) });
    await dueno().patch(`/pedidos-b2b/${completado.id}/avanzar`).expect(200);
    await cerrarEntregasB2b(dueno(), completado.id);
    const cancelado = await crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_PASADA, ...n(4) });
    await dueno().patch(`/pedidos-b2b/${cancelado.id}/cancelar`).expect(200);
    const confirmado = await crearAdminB2b(s.h, s.base, { semanaInicio: SEMANA_ACTUAL, ...n(5) });
    await dueno().patch(`/pedidos-b2b/${confirmado.id}/avanzar`).expect(200);
    ids = { porConfirmarPasada: porConfirmarPasada.id, enProcesoPasada: enProcesoPasada.id, completado: completado.id, cancelado: cancelado.id, confirmado: confirmado.id };
  });

  const listar = async (qs: string) => ((await dueno().get(`/pedidos-b2b?${qs}`).expect(200)).body.data as { id: string }[]).map((r) => r.id).sort();
  const csvFolios = async (qs: string) =>
    (await dueno().get(`/pedidos-b2b/export?${qs}`).expect(200)).text.split('\r\n').slice(1).filter(Boolean).length;

  it('sin parámetros nuevos el listado conserva su contrato: devuelve todos los pedidos', async () => {
    expect(await listar('')).toHaveLength(5);
  });

  it('soloHistorico: únicamente Completados y Cancelados (nunca Por confirmar, Confirmado ni En proceso)', async () => {
    expect(await listar('soloHistorico=true')).toStrictEqual([ids.completado, ids.cancelado].sort());
    expect(await listar('soloHistorico=true&estado=COMPLETADO&cancelado=false')).toStrictEqual([ids.completado]);
    expect(await listar('soloHistorico=true&cancelado=true')).toStrictEqual([ids.cancelado]);
    // un filtro de estado activo junto con soloHistorico no puede colar pedidos activos
    expect(await listar('soloHistorico=true&estado=EN_PROCESO')).toStrictEqual([]);
    expect(await csvFolios('soloHistorico=true')).toBe(2);
  });

  it('semanaAntesDe + estados + cancelado=false: los pedidos activos de semanas anteriores', async () => {
    const qs = `estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false&semanaAntesDe=${SEMANA_ACTUAL}`;
    expect(await listar(qs)).toStrictEqual([ids.porConfirmarPasada, ids.enProcesoPasada].sort());
    expect(await csvFolios(qs)).toBe(2);
    // la semana actual no cuenta como "anterior"
    expect(await listar(`${qs.replace(SEMANA_ACTUAL, SEMANA_PASADA)}`)).toStrictEqual([]);
  });

  it('semanaAntesDe con formato inválido da 400', async () => {
    expect((await dueno().get('/pedidos-b2b?semanaAntesDe=ayer')).status).toBe(400);
  });
});
