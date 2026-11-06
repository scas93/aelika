import ExcelJS from 'exceljs';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import {
  apiRol,
  crearAdminB2b,
  SEMANA_ACTUAL,
  SEMANA_PASADA,
  SEMANA_PROXIMA,
} from './b2b-helpers';
import { ResumenSemanalArmadoService } from '../../src/resumen-semanal/resumen-semanal-armado.service';
import { semanaAnterior } from '../../src/resumen-semanal/resumen-semanal';

// Resumen semanal por correo: CONTENIDO y ADJUNTO de un negocio de mayoreo. Reloj de la suite: miércoles 2026-09-30 10:00 CDMX →
// semana anterior = 2026-09-21 a 2026-09-27 (SEMANA_PASADA). Pedido por defecto: Café LUNES 6 + MIÉRCOLES 6 y Concha VIERNES 4 =
// 16 piezas, $662, tres entregas.
describe('Resumen semanal · armado (mayoreo)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const semana = () => semanaAnterior(new Date());
  const armar = (tenantId = s.base.tenant.id, nombre = 'Banetto Mayoreo') =>
    new ResumenSemanalArmadoService(s.h.prisma).armar(
      tenantId,
      nombre,
      semana(),
    );
  const pedido = (
    negocioNombre: string,
    semanaInicio = SEMANA_PASADA,
    extra: Record<string, unknown> = {},
  ) =>
    crearAdminB2b(s.h, s.base, {
      negocioNombre,
      contactoTelefono: `55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      semanaInicio,
      ...extra,
    });
  const hojas = async (buf: Buffer) => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buf as any);
    return libro.worksheets.map((h) => ({
      nombre: h.name,
      valores: (h.getSheetValues() as unknown[]).slice(1),
    }));
  };

  it('semana anterior = la del reloj; solo entran los pedidos de esa semana', async () => {
    expect(semana()).toEqual({ inicio: SEMANA_PASADA, fin: '2026-09-27' });
    await pedido('Pasada Uno');
    await pedido('Pasada Dos');
    await pedido('De esta semana', SEMANA_ACTUAL);
    await pedido('De la próxima', SEMANA_PROXIMA);
    const r = await armar();
    expect(r.totales).toMatchObject({
      pedidos: 2,
      porConfirmar: 2,
      cancelados: 0,
      piezas: 32,
      totalCentavos: 132400,
      hayPedidos: true,
    });
    expect(r.totales.entregas).toMatchObject({ pendientes: 6 });
    const [pedidos, entregas] = await hojas(r.adjunto!.contenido);
    expect([pedidos.nombre, entregas.nombre]).toEqual(['Pedidos', 'Entregas']);
    expect(pedidos.valores.length - 1).toBe(2); // encabezado + 2 pedidos
    expect(entregas.valores.length - 1).toBe(6);
    expect(r.adjunto!.nombreArchivo).toBe(
      'Pedidos Banetto Mayoreo 2026-09-21 al 2026-09-27.xlsx',
    );
  });

  it('el adjunto es IDÉNTICO al que el Dueño exporta desde el panel para esa semana (Históricos)', async () => {
    await pedido('Pasada Uno');
    const b = await pedido('Pasada Dos');
    await dueno().patch(`/pedidos-b2b/${b.id}/cancelar`).expect(200);
    await pedido('Fuera', SEMANA_ACTUAL);
    const r = await armar();
    const res = await dueno()
      .get(
        `/pedidos-b2b/export-xlsx?vista=HISTORICOS&desde=${SEMANA_PASADA}&hasta=${SEMANA_PASADA}`,
      )
      .buffer(true)
      .parse((rs, cb) => {
        const t: Buffer[] = [];
        rs.on('data', (x: Buffer) => t.push(x));
        rs.on('end', () => cb(null, Buffer.concat(t)));
      });
    expect(res.status).toBe(200);
    expect(await hojas(r.adjunto!.contenido)).toEqual(await hojas(res.body));
  });

  it('pedido cancelado: sale en el Excel como Cancelado, se cuenta aparte y no suma (ni sus entregas ya cerradas)', async () => {
    const a = await pedido('Vivo');
    const b = await pedido('Cancelado con entrega cerrada');
    await dueno().patch(`/pedidos-b2b/${b.id}/avanzar`).expect(200);
    const detalle = (await dueno().get(`/pedidos-b2b/${b.id}`).expect(200))
      .body;
    await dueno()
      .patch(`/pedidos-b2b/${b.id}/entregas/${detalle.entregas[0].id}/cerrar`)
      .send({ estado: 'ENTREGADA' })
      .expect(200);
    await dueno().patch(`/pedidos-b2b/${b.id}/cancelar`).expect(200);
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    const r = await armar();
    expect(r.totales).toMatchObject({
      pedidos: 1,
      confirmados: 1,
      cancelados: 1,
      piezas: 16,
      totalCentavos: 66200,
    });
    // Sus entregas (una ENTREGADA que se conservó y dos canceladas) no suman en las entregas del resumen.
    expect(r.totales.entregas).toEqual({
      pendientes: 3,
      listas: 0,
      entregadas: 0,
      noRecogidas: 0,
      canceladas: 0,
    });
    const [pedidos] = await hojas(r.adjunto!.contenido);
    const texto = JSON.stringify(pedidos.valores);
    expect(texto).toContain('Cancelado');
    expect(r.correo.texto).toContain('Cancelados (no suman): 1');
  });

  it('cobranza: pagado y pendiente (monto y número de pedidos)', async () => {
    const a = await pedido('Paga');
    await pedido('Debe');
    await dueno().patch(`/pedidos-b2b/${a.id}/marcar-pagado`).expect(200);
    const r = await armar();
    expect(r.totales).toMatchObject({
      pagados: 1,
      pagadoCentavos: 66200,
      pendientesDePago: 1,
      pendienteCentavos: 66200,
    });
    expect(r.correo.texto).toContain('Pagado: $662.00 (1 pedido)');
    expect(r.correo.texto).toContain('Pendiente de pago: $662.00 (1 pedido)');
  });

  it('entregas en días distintos de la semana: todas pertenecen a su pedido y a su semana', async () => {
    await pedido('Tres días');
    const r = await armar();
    const [, entregas] = await hojas(r.adjunto!.contenido);
    expect(entregas.valores.length - 1).toBe(3);
    expect(JSON.stringify(entregas.valores)).toContain('Tres días');
  });

  it('semana sin pedidos: correo corto y SIN adjunto', async () => {
    await pedido('Solo esta semana', SEMANA_ACTUAL);
    const r = await armar();
    expect(r.totales.hayPedidos).toBe(false);
    expect(r.adjunto).toBeUndefined();
    expect(r.correo.texto).toContain('Sin pedidos esta semana');
  });

  it('solo cancelados: hay correo completo con adjunto y totales en cero', async () => {
    const a = await pedido('Cancelado');
    await dueno().patch(`/pedidos-b2b/${a.id}/cancelar`).expect(200);
    const r = await armar();
    expect(r.totales).toMatchObject({
      pedidos: 0,
      cancelados: 1,
      totalCentavos: 0,
    });
    expect(r.adjunto).toBeDefined();
  });

  it('aislamiento: nunca se mezclan pedidos de otro negocio', async () => {
    await pedido('Mío');
    const otro = await seedBase(s.h.prisma, {
      slug: 'otro-mayoreo',
      tipoStorefront: 'RETAIL_B2B',
    });
    await crearAdminB2b(s.h, otro, {
      negocioNombre: 'Ajeno',
      contactoTelefono: '5599990000',
      semanaInicio: SEMANA_PASADA,
    });
    await crearAdminB2b(s.h, otro, {
      negocioNombre: 'Ajeno Dos',
      contactoTelefono: '5599990001',
      semanaInicio: SEMANA_PASADA,
    });
    const mio = await armar();
    const suyo = await armar(otro.tenant.id, 'Otro');
    expect(mio.totales.pedidos).toBe(1);
    expect(suyo.totales.pedidos).toBe(2);
    expect(JSON.stringify(await hojas(mio.adjunto!.contenido))).not.toContain(
      'Ajeno',
    );
    expect(JSON.stringify(await hojas(suyo.adjunto!.contenido))).not.toContain(
      'Mío',
    );
  });

  it('nombres con acentos y caracteres especiales: asunto y archivo quedan en una línea y sin caracteres inválidos', async () => {
    await pedido('Panadería Ñandú "La Niña"');
    const r = await armar(
      s.base.tenant.id,
      'Panadería/Ñandú: "La Niña"\nBcc: x@y.co',
    );
    expect(r.correo.asunto).not.toMatch(/[\r\n]/);
    expect(r.adjunto!.nombreArchivo).toBe(
      'Pedidos PanaderíaÑandú La Niña Bcc x@y.co 2026-09-21 al 2026-09-27.xlsx',
    );
    expect(r.adjunto!.nombreArchivo).not.toMatch(/[\\/:*?"<>|\r\n]/);
  });
});
