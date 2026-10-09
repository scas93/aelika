import ExcelJS from 'exceljs';
import { usarSuite } from './helpers';
import { apiRol, crearAdminB2b, cerrarEntregasB2b } from './b2b-helpers';

// Exportaciones B2B en Excel real (.xlsx): Entregas del día (hojas Entregas y Consolidado), Históricos y Pedidos activos.
// Los CSV de B2B siguen existiendo (cubiertos por b2b-panel) pero el panel ya no los usa.
describe('B2B · exportaciones Excel', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');

  const descargar = async (api: ReturnType<typeof apiRol>, ruta: string) => {
    const res = await api
      .get(ruta)
      .buffer(true)
      .parse((r, cb) => {
        const trozos: Buffer[] = [];
        r.on('data', (t: Buffer) => trozos.push(t));
        r.on('end', () => cb(null, Buffer.concat(trozos)));
      });
    expect(res.status).toBe(200);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(res.body);
    return { libro, headers: res.headers };
  };
  const filas = (hoja: ExcelJS.Worksheet) => {
    const out: Record<string, ExcelJS.CellValue>[] = [];
    const encabezados = (hoja.getRow(1).values as ExcelJS.CellValue[]).slice(
      1,
    ) as string[];
    hoja.eachRow((row, n) => {
      if (n === 1) return;
      const v = (row.values as ExcelJS.CellValue[]).slice(1);
      out.push(
        Object.fromEntries(encabezados.map((e, i) => [e, v[i] ?? null])),
      );
    });
    return out;
  };

  /** Dos pedidos de negocios distintos con Café americano el lunes 5 de oct; el segundo luego se cancela; un tercero queda aparte. */
  const escenario = async () => {
    // 2g: el producto lleva ID del ERP y el pedido de Abarrotes Uno una nota del cliente (salen en el Excel).
    await s.h.prisma.product.update({
      where: { id: s.base.productoA.id },
      data: { erpId: 'ERP-CAFE-01' },
    });
    const a = await crearAdminB2b(s.h, s.base, {
      negocioNombre: 'Abarrotes Uno',
      contactoTelefono: '5511000001',
      notaCliente: 'Sin azúcar',
    });
    const b = await crearAdminB2b(s.h, s.base, {
      negocioNombre: 'Bodega Dos',
      contactoTelefono: '5511000002',
    });
    const c = await crearAdminB2b(s.h, s.base, {
      negocioNombre: 'Cafetería Tres',
      contactoTelefono: '5511000003',
    });
    return { a, b, c };
  };

  it('Entregas del día: hojas Entregas y Consolidado, sin canceladas, números y fechas reales, formato de encabezado', async () => {
    const { a, b, c } = await escenario();
    await dueno().patch(`/pedidos-b2b/${b.id}/cancelar`).expect(200); // sus entregas pasan a Canceladas: no deben salir
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    const detalleA = (await dueno().get(`/pedidos-b2b/${a.id}`).expect(200))
      .body;
    await dueno()
      .patch(`/pedidos-b2b/${a.id}/entregas/${detalleA.entregas[0].id}/cerrar`)
      .send({ estado: 'ENTREGADA' })
      .expect(200);

    const { libro, headers } = await descargar(
      apiRol(s.h, s.base, 'OPERADOR'),
      '/pedidos-b2b/dia/2026-10-05/export-xlsx',
    );
    expect(headers['content-type']).toContain('spreadsheetml.sheet');
    expect(headers['content-disposition']).toContain(
      'entregas-2026-10-05.xlsx',
    );
    expect(libro.worksheets.map((h) => h.name)).toStrictEqual([
      'Entregas',
      'Consolidado',
    ]);

    const entregas = libro.getWorksheet('Entregas')!;
    expect((entregas.getRow(1).values as string[]).slice(1)).toStrictEqual([
      'Fecha de entrega',
      'Folio',
      'Código del cliente',
      'Negocio',
      'Estado de la entrega',
      'Categoría',
      'Producto',
      'ID del ERP',
      'Cantidad',
      'Precio unitario',
      'Subtotal',
      'Nota del cliente',
    ]);
    expect(entregas.getRow(1).font?.bold).toBe(true);
    expect(entregas.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(entregas.autoFilter).toBeTruthy();

    const f = filas(entregas);
    // Lunes 5 de oct: Café americano ×6 de A (Entregada) y de C (Pendiente); B está cancelado y no aparece.
    expect(
      f.map((r) => [
        r['Negocio'],
        r['Estado de la entrega'],
        r['Producto'],
        r['Cantidad'],
        r['Precio unitario'],
        r['Subtotal'],
        r['Categoría'],
      ]),
    ).toStrictEqual([
      ['Abarrotes Uno', 'Entregada', 'Café americano', 6, 45, 270, 'Bebidas'],
      ['Cafetería Tres', 'Pendiente', 'Café americano', 6, 45, 270, 'Bebidas'],
    ]);
    // 2g: código del cliente, ID del ERP del producto y nota del cliente (vacía si el pedido no tiene).
    expect(
      f.map((r) => [r['Negocio'], r['ID del ERP'], r['Nota del cliente']]),
    ).toStrictEqual([
      ['Abarrotes Uno', 'ERP-CAFE-01', 'Sin azúcar'],
      ['Cafetería Tres', 'ERP-CAFE-01', null],
    ]);
    expect(f.map((r) => r['Código del cliente'])).toStrictEqual([
      expect.stringMatching(/^cafe-test-abarrotes-uno-\d+$/),
      expect.stringMatching(/^cafe-test-cafeteria-tres-\d+$/),
    ]);
    // Formatos: moneda con $ y fechas con formato de fecha (se pueden sumar y filtrar en Excel).
    expect(entregas.getCell('J2').numFmt).toContain('$');
    expect(entregas.getCell('K2').numFmt).toContain('$');
    expect(entregas.getCell('A2').numFmt).toBe('dd/mm/yyyy');
    expect(f[0]['Fecha de entrega']).toBeInstanceOf(Date);
    expect((f[0]['Fecha de entrega'] as Date).toISOString().slice(0, 10)).toBe(
      '2026-10-05',
    );
    expect(f.some((r) => r['Folio'] === b.folio)).toBe(false);
    expect(c.folio).toBeTruthy();

    const consolidado = filas(libro.getWorksheet('Consolidado')!);
    expect(consolidado).toHaveLength(1);
    expect(consolidado[0]).toMatchObject({
      Categoría: 'Bebidas',
      Producto: 'Café americano',
      'ID del ERP': 'ERP-CAFE-01',
      'Cantidad total': 12,
      Clientes: 2,
    });
    // La cantidad total de cada producto coincide con la suma de la hoja Entregas.
    const sumaEntregas = f
      .filter((r) => r['Producto'] === 'Café americano')
      .reduce((n, r) => n + (r['Cantidad'] as number), 0);
    expect(consolidado[0]['Cantidad total']).toBe(sumaEntregas);
  });

  it('Históricos / Pedidos activos: una fila por pedido, todo en español, montos numéricos y filtros respetados', async () => {
    const { a, b } = await escenario();
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    await cerrarEntregasB2b(dueno(), a.id); // Completado
    await dueno().patch(`/pedidos-b2b/${a.id}/marcar-pagado`).expect(200);
    await dueno().patch(`/pedidos-b2b/${b.id}/cancelar`).expect(200);

    const todos = await descargar(
      apiRol(s.h, s.base, 'OPERADOR'),
      '/pedidos-b2b/export-xlsx?soloHistorico=true',
    );
    expect(todos.libro.worksheets.map((h) => h.name)).toStrictEqual([
      'Pedidos',
    ]);
    expect(
      (todos.libro.getWorksheet('Pedidos')!.getRow(1).values as string[]).slice(
        1,
      ),
    ).toStrictEqual([
      'Folio',
      'Código del cliente',
      'Negocio',
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
    const f = filas(todos.libro.getWorksheet('Pedidos')!);
    const porNegocio = Object.fromEntries(
      f.map((r) => [r['Negocio'] as string, r]),
    );
    expect(Object.keys(porNegocio).sort()).toStrictEqual([
      'Abarrotes Uno',
      'Bodega Dos',
    ]); // solo Completados y Cancelados
    expect(porNegocio['Abarrotes Uno']).toMatchObject({
      'Estado del pedido': 'Completado',
      'Estado de pago': 'Pagado',
      'Entregas totales': 3,
      Entregadas: 3,
      'No recogidas': 0,
      Canceladas: 0,
      Subtotal: 662,
      'Descuento %': 0,
      'Descuento $': 0,
      Total: 662,
    });
    expect(porNegocio['Abarrotes Uno']['Fecha de pago']).toBeInstanceOf(Date);
    expect(porNegocio['Bodega Dos']).toMatchObject({
      'Estado del pedido': 'Cancelado',
      'Estado de pago': 'Pendiente',
      'Fecha de pago': null,
      'Entregas totales': 3,
      Canceladas: 3,
      Entregadas: 0,
    });
    // 2g: código y nota del cliente.
    expect(porNegocio['Abarrotes Uno']['Código del cliente']).toMatch(
      /^cafe-test-abarrotes-uno-\d+$/,
    );
    expect(porNegocio['Abarrotes Uno']['Nota del cliente']).toBe('Sin azúcar');
    expect(porNegocio['Bodega Dos']['Nota del cliente']).toBeNull();
    expect(porNegocio['Abarrotes Uno']['Semana (inicio)']).toBeInstanceOf(Date);
    expect(
      (porNegocio['Abarrotes Uno']['Semana (fin)'] as Date)
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-10-11');
    // Ningún valor técnico visible.
    for (const r of f)
      for (const v of Object.values(r))
        if (typeof v === 'string')
          expect(v).not.toMatch(
            /[A-Z]{3,}_[A-Z_]+|^(PAGADO|PENDIENTE|CANCELADO|COMPLETADO)$/,
          );

    // Filtro: solo Pagados.
    const pagados = filas(
      (
        await descargar(dueno(), '/pedidos-b2b/export-xlsx?estadoPago=PAGADO')
      ).libro.getWorksheet('Pedidos')!,
    );
    expect(pagados.map((r) => r['Negocio'])).toStrictEqual(['Abarrotes Uno']);

    // Pedidos activos de la semana (Por confirmar + Confirmado + En proceso, no cancelados): solo Cafetería Tres.
    const activos = filas(
      (
        await descargar(
          dueno(),
          '/pedidos-b2b/export-xlsx?estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false&desde=2026-10-05&hasta=2026-10-05',
        )
      ).libro.getWorksheet('Pedidos')!,
    );
    expect(
      activos.map((r) => [r['Negocio'], r['Estado del pedido']]),
    ).toStrictEqual([['Cafetería Tres', 'Por confirmar']]);
  });

  it('los 3 roles pueden exportar los tres archivos', async () => {
    await escenario();
    for (const rol of ['OPERADOR', 'GERENTE', 'DUENO'] as const) {
      for (const ruta of [
        '/pedidos-b2b/dia/2026-10-05/export-xlsx',
        '/pedidos-b2b/export-xlsx',
        '/pedidos-b2b/export-xlsx?soloHistorico=true',
      ]) {
        expect([
          rol,
          ruta,
          (await descargar(apiRol(s.h, s.base, rol), ruta)).libro.worksheets
            .length > 0,
        ]).toStrictEqual([rol, ruta, true]);
      }
    }
  });
});
