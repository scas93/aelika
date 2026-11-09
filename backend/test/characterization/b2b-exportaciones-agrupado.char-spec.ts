import ExcelJS from 'exceljs';
import { usarSuite } from './helpers';
import {
  apiRol,
  crearAdminB2b,
  SEMANA_ACTUAL,
  SEMANA_PASADA,
} from './b2b-helpers';

// Excel de Históricos del panel con bloques por negocio, pedido y entrega (hojas «Pedidos» y «Entregas») + las tablas planas
// («Datos pedidos» y «Datos entregas»). Pedidos activos, Entregas del día y el resumen semanal NO cambian (sus suites lo cubren).
describe('B2B · Excel de Históricos con bloques', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const A = () => s.base.productoA.id; // Café americano $45
  const B = () => s.base.productoB.id; // Concha $30.50

  const descargar = async (qs = '') => {
    const res = await dueno()
      .get(`/pedidos-b2b/export-xlsx?vista=HISTORICOS${qs}`)
      .buffer(true)
      .parse((r, cb) => {
        const t: Buffer[] = [];
        r.on('data', (c: Buffer) => t.push(c));
        r.on('end', () => cb(null, Buffer.concat(t)));
      });
    expect(res.status).toBe(200);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(res.body);
    return libro;
  };

  const pedido = (
    negocio: string,
    tel: string,
    semanaInicio: string,
    items: unknown[],
  ) =>
    crearAdminB2b(s.h, s.base, {
      negocioNombre: negocio,
      contactoTelefono: tel,
      semanaInicio,
      items,
    });
  const dist = (productId: string, ...dias: [string, number][]) => ({
    productId,
    distribucion: dias.map(([dia, cantidad]) => ({ dia, cantidad })),
  });

  // Lee una hoja en filas tipadas: banda de negocio (celda combinada), pedido/entrega (col 2 con fecha), producto (col 1 con sangría).
  type Fila = {
    n: number;
    v: ExcelJS.CellValue[];
    banda: boolean;
    fecha: boolean;
  };
  const texto = (v: ExcelJS.CellValue | undefined) =>
    typeof v === 'string' ? v : '';
  const leer = (hoja: ExcelJS.Worksheet): Fila[] => {
    const out: Fila[] = [];
    hoja.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const v = (row.values as ExcelJS.CellValue[]).slice(1);
      out.push({
        n,
        v,
        banda:
          row.getCell(1).isMerged &&
          v.slice(1).every((x) => x == null || x === v[0]),
        fecha: v[1] instanceof Date,
      });
    });
    return out;
  };

  async function escenario() {
    // Orden de captura a propósito NO alfabético. Dos semanas.
    const zeta = await pedido('Zeta Café', '5511000010', SEMANA_PASADA, [
      dist(A(), ['LUNES', 2], ['MIERCOLES', 4]),
    ]);
    const alfa1 = await pedido('Alfa Panes', '5511000011', SEMANA_ACTUAL, [
      dist(A(), ['LUNES', 3]),
      dist(B(), ['LUNES', 2], ['VIERNES', 4]),
    ]);
    const alfa0 = await pedido('Alfa Panes', '5511000011', SEMANA_PASADA, [
      dist(B(), ['LUNES', 5]),
    ]);
    return { zeta, alfa1, alfa0 };
  }

  it('hojas: Pedidos y Entregas con bloques y, al final, «Datos pedidos» y «Datos entregas»', async () => {
    await escenario();
    const libro = await descargar();
    expect(libro.worksheets.map((h) => h.name)).toStrictEqual([
      'Pedidos',
      'Entregas',
      'Datos pedidos',
      'Datos entregas',
    ]);
    for (const nombre of ['Pedidos', 'Entregas']) {
      const hoja = libro.getWorksheet(nombre)!;
      expect(hoja.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(hoja.pageSetup).toMatchObject({
        orientation: 'landscape',
        fitToWidth: 1,
      });
      expect(hoja.getRow(1).font?.bold).toBe(true);
    }
  });

  it('Pedidos: negocios en orden alfabético con su encabezado, pedidos de la semana más reciente a la más antigua, sin columna Negocio', async () => {
    await escenario();
    const hoja = (await descargar()).getWorksheet('Pedidos')!;
    expect((hoja.getRow(1).values as string[]).slice(1)).toStrictEqual([
      'Semana (inicio)',
      'Semana (fin)',
      'Fecha de creación',
      'Estado del pedido',
      'Estado de pago',
      'Fecha de pago',
      'Entregas totales',
      'Entregadas',
      'No recogidas',
      'Canceladas',
      'Subtotal',
      'Descuento %',
      'Descuento $',
      'Total',
      'Nota del cliente',
    ]);
    const filas = leer(hoja);
    expect(filas.filter((f) => f.banda).map((f) => f.v[0])).toStrictEqual([
      'Alfa Panes',
      'Zeta Café',
    ]);
    const semanas = filas
      .filter((f) => f.fecha)
      .map((f) => (f.v[0] as Date).toISOString().slice(0, 10));
    expect(semanas).toStrictEqual([
      SEMANA_ACTUAL,
      SEMANA_PASADA,
      SEMANA_PASADA,
    ]); // Alfa (reciente, antigua), luego Zeta
  });

  it('Pedidos: debajo de cada pedido, sus productos consolidados; los montos suman el Subtotal del pedido', async () => {
    await escenario();
    const hoja = (await descargar()).getWorksheet('Pedidos')!;
    const filas = leer(hoja);
    let subtotal = 0;
    let suma = 0;
    let revisados = 0;
    const cerrar = () => {
      if (subtotal) {
        expect(Math.round(suma * 100)).toBe(Math.round(subtotal * 100));
        revisados++;
      }
    };
    const productos: Record<string, number> = {};
    for (const f of filas) {
      if (f.banda) continue;
      if (f.fecha) {
        cerrar();
        subtotal = f.v[10] as number; // Subtotal
        suma = 0;
      } else if (
        f.v[0] === 'Producto' ||
        texto(f.v[0]).startsWith('Subtotal de productos')
      ) {
        continue;
      } else if (typeof f.v[1] === 'number' && typeof f.v[2] === 'number') {
        suma += f.v[2];
        productos[`${subtotal}|${texto(f.v[0])}`] = f.v[1];
      }
    }
    cerrar();
    expect(revisados).toBe(3);
    // Alfa semana actual: Café x3 + Concha x6 (2 + 4) = 135 + 183 = 318 → los productos del pedido se suman entre sus entregas.
    expect(productos['318|Café americano']).toBe(3);
    expect(productos['318|Concha']).toBe(6);
    // Hay una fila de «Producto / Unidades / Monto» y un «Subtotal de productos» por pedido.
    expect(filas.filter((f) => f.v[0] === 'Producto')).toHaveLength(3);
    expect(
      filas.filter((f) => f.v[0] === 'Subtotal de productos'),
    ).toHaveLength(3);
  });

  it('Pedidos: un pedido cancelado sigue marcado y conserva los productos de sus entregas cerradas', async () => {
    const beta = await pedido('Beta', '5511000012', SEMANA_PASADA, [
      dist(B(), ['LUNES', 5], ['MIERCOLES', 3]),
    ]);
    await s.h.prisma.detalleB2B.update({
      where: { orderId: beta.id },
      data: { minimoPiezasAplicado: 0 },
    });
    await dueno().patch(`/pedidos-b2b/${beta.id}/avanzar`).expect(200);
    const det = (await dueno().get(`/pedidos-b2b/${beta.id}`).expect(200)).body;
    await dueno()
      .patch(`/pedidos-b2b/${beta.id}/entregas/${det.entregas[0].id}/cerrar`)
      .send({ estado: 'ENTREGADA' })
      .expect(200);
    await dueno().patch(`/pedidos-b2b/${beta.id}/cancelar`).expect(200);
    const filas = leer(
      (await descargar('&cancelado=true')).getWorksheet('Pedidos')!,
    );
    const ped = filas.find((f) => f.fecha)!;
    expect(ped.v[3]).toBe('Cancelado'); // Estado del pedido
    expect([ped.v[7], ped.v[9]]).toStrictEqual([1, 1]); // Entregadas 1; Canceladas 1
    const producto = filas.find((f) => f.v[0] === 'Concha');
    expect([producto?.v[1], producto?.v[2]]).toStrictEqual([5, 152.5]); // solo lo de la entrega cerrada
  });

  it('Entregas: por negocio, por entrega ordenada por fecha, con día, fecha, estado, piezas, importe y productos que suman el importe', async () => {
    await escenario();
    const hoja = (await descargar()).getWorksheet('Entregas')!;
    const filas = leer(hoja);
    expect(
      filas
        .filter((f) => f.banda && !texto(f.v[0]).startsWith('Semana del'))
        .map((f) => f.v[0]),
    ).toStrictEqual(['Alfa Panes', 'Zeta Café']);
    // Hay dos semanas: cada pedido lleva su encabezado «Semana del …».
    expect(
      filas.filter((f) => f.banda && texto(f.v[0]).startsWith('Semana del')),
    ).toHaveLength(3);

    let importe = 0;
    let piezas = 0;
    let sumaMonto = 0;
    let sumaUnidades = 0;
    let entregas = 0;
    const cerrar = () => {
      if (entregas === 0) return;
      expect(Math.round(sumaMonto * 100)).toBe(Math.round(importe * 100));
      expect(sumaUnidades).toBe(piezas);
    };
    for (const f of filas) {
      if (f.banda) continue;
      if (f.fecha) {
        cerrar();
        entregas++;
        expect([
          'Lunes',
          'Martes',
          'Miércoles',
          'Jueves',
          'Viernes',
          'Sábado',
          'Domingo',
        ]).toContain(f.v[0]);
        expect(['Pendiente', 'Atrasada']).toContain(f.v[2]); // semanas ya pasadas: Atrasada
        piezas = f.v[3] as number;
        importe = f.v[4] as number;
        sumaMonto = 0;
        sumaUnidades = 0;
      } else if (typeof f.v[3] === 'number') {
        sumaUnidades += f.v[3];
        sumaMonto += f.v[4] as number;
      }
    }
    cerrar();
    expect(entregas).toBe(5); // Alfa actual 2 (lunes y viernes) + Alfa pasada 1 + Zeta 2
  });

  it('Entregas: con una sola semana no se repite el encabezado de semana; las entregas canceladas no se listan', async () => {
    const { alfa1 } = await escenario();
    await dueno().patch(`/pedidos-b2b/${alfa1.id}/cancelar`).expect(200);
    const filas = leer(
      (
        await descargar(
          `&desde=${SEMANA_ACTUAL}&hasta=${SEMANA_ACTUAL}&cancelado=true`,
        )
      ).getWorksheet('Entregas')!,
    );
    expect(
      filas.filter((f) => f.banda && texto(f.v[0]).startsWith('Semana del')),
    ).toHaveLength(0);
    expect(filas.filter((f) => f.fecha)).toHaveLength(0); // todas sus entregas quedaron canceladas
  });

  it('las hojas planas tienen las mismas filas y columnas de siempre (exportan lo mismo que la pantalla)', async () => {
    await escenario();
    const libro = await descargar();
    const lista = (
      await dueno().get('/pedidos-b2b?page=1&limit=100').expect(200)
    ).body.data as { negocioNombre: string }[];
    const datos = libro.getWorksheet('Datos pedidos')!;
    expect(datos.actualRowCount - 1).toBe(lista.length);
    expect((datos.getRow(1).values as string[]).slice(1, 3)).toStrictEqual([
      'Negocio',
      'Semana (inicio)',
    ]);
    expect(datos.autoFilter).toBeTruthy();
    expect(libro.getWorksheet('Datos entregas')!.actualRowCount - 1).toBe(5);
  });

  it('Pedidos activos y Entregas del día conservan su formato', async () => {
    await escenario();
    const activos = new ExcelJS.Workbook();
    const res = await dueno()
      .get('/pedidos-b2b/export-xlsx')
      .buffer(true)
      .parse((r, cb) => {
        const t: Buffer[] = [];
        r.on('data', (c: Buffer) => t.push(c));
        r.on('end', () => cb(null, Buffer.concat(t)));
      });
    await activos.xlsx.load(res.body);
    expect(activos.worksheets.map((h) => h.name)).toStrictEqual([
      'Pedidos',
      'Entregas',
    ]);
    expect(
      (activos.getWorksheet('Pedidos')!.getRow(1).values as string[]).slice(
        1,
        3,
      ),
    ).toStrictEqual(['Negocio', 'Semana (inicio)']);
  });
});
