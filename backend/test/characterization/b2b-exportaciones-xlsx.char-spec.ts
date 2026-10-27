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
    // Columnas definidas por producto: la hoja ya no trae Folio ni Código del cliente.
    expect(Object.keys(f[0])).not.toContain('Folio');
    expect(Object.keys(f[0])).not.toContain('Código del cliente');
    // Formatos: moneda con $ y fechas con formato de fecha (se pueden sumar y filtrar en Excel).
    expect(entregas.getCell('H2').numFmt).toContain('$');
    expect(entregas.getCell('I2').numFmt).toContain('$');
    expect(entregas.getCell('A2').numFmt).toBe('dd/mm/yyyy');
    expect(f[0]['Fecha de entrega']).toBeInstanceOf(Date);
    expect((f[0]['Fecha de entrega'] as Date).toISOString().slice(0, 10)).toBe(
      '2026-10-05',
    );
    expect(f.some((r) => r['Negocio'] === 'Bodega Dos')).toBe(false); // el cancelado no sale
    expect(c.folio).toBeTruthy();
    expect(b.folio).toBeTruthy();

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

  it('Entregas del día · sin Folio, el desempate sigue siendo el orden de captura (mismo negocio y día)', async () => {
    const lunes = (cantidad: number) => [
      { productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad }] },
    ];
    await crearAdminB2b(s.h, s.base, { negocioNombre: 'Mismo Negocio', contactoTelefono: '5511000020', items: lunes(6) });
    await crearAdminB2b(s.h, s.base, { negocioNombre: 'Mismo Negocio', contactoTelefono: '5511000021', items: lunes(3) });
    const { libro } = await descargar(dueno(), '/pedidos-b2b/dia/2026-10-05/export-xlsx');
    const f = filas(libro.getWorksheet('Entregas')!);
    expect(f.map((r) => [r['Negocio'], r['Cantidad']])).toStrictEqual([
      ['Mismo Negocio', 6],
      ['Mismo Negocio', 3],
    ]);
  });

  it('Históricos / Pedidos activos: una fila por pedido, todo en español, montos numéricos y filtros respetados', async () => {
    const { a, b } = await escenario();
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    await cerrarEntregasB2b(dueno(), a.id); // Completado
    await dueno().patch(`/pedidos-b2b/${a.id}/marcar-pagado`).expect(200);
    await dueno().patch(`/pedidos-b2b/${b.id}/cancelar`).expect(200);

    // Históricos ahora lista TODOS los pedidos (también los activos): sin soloHistorico; `vista` solo elige las columnas.
    const todos = await descargar(
      apiRol(s.h, s.base, 'OPERADOR'),
      '/pedidos-b2b/export-xlsx?vista=HISTORICOS',
    );
    expect(todos.libro.worksheets.map((h) => h.name)).toStrictEqual([
      'Pedidos',
      'Entregas',
    ]);
    // Entregas no canceladas de TODOS los pedidos: las 3 Entregadas del Completado y las 3 Pendientes del activo (Cafetería
    // Tres); las del cancelado (todas Canceladas) no salen.
    const entregasHist = filas(todos.libro.getWorksheet('Entregas')!);
    expect(
      entregasHist.map((r) => [r['Negocio'], r['Estado de la entrega']]),
    ).toStrictEqual([
      ['Abarrotes Uno', 'Entregada'],
      ['Cafetería Tres', 'Pendiente'],
      ['Abarrotes Uno', 'Entregada'],
      ['Cafetería Tres', 'Pendiente'],
      ['Abarrotes Uno', 'Entregada'],
      ['Cafetería Tres', 'Pendiente'],
    ]);
    expect(
      (todos.libro.getWorksheet('Pedidos')!.getRow(1).values as string[]).slice(
        1,
      ),
    ).toStrictEqual([
      // Columnas de Históricos definidas por producto: sin Folio ni Código del cliente.
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
      'Cafetería Tres',
    ]); // Completado, Cancelado y también el pedido activo (Por confirmar)
    expect(porNegocio['Cafetería Tres']['Estado del pedido']).toBe('Por confirmar');
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
    // Sin Folio ni Código del cliente; la nota del cliente se conserva (2g).
    expect(Object.keys(porNegocio['Abarrotes Uno'])).not.toContain('Folio');
    expect(Object.keys(porNegocio['Abarrotes Uno'])).not.toContain('Código del cliente');
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

  it('hoja Entregas: una fila por entrega no cancelada, importe antes de descuento, Atrasada, filtros y hoja vacía con encabezados', async () => {
    const { a, b } = await escenario();
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    const detalleA = (await dueno().get(`/pedidos-b2b/${a.id}`).expect(200))
      .body;
    await dueno()
      .patch(`/pedidos-b2b/${a.id}/entregas/${detalleA.entregas[0].id}/cerrar`)
      .send({ estado: 'ENTREGADA' })
      .expect(200);
    await dueno().patch(`/pedidos-b2b/${b.id}/cancelar`).expect(200);
    // Jueves 8 de oct: lo Pendiente del lunes 5 y del miércoles 7 está atrasado; el viernes 9 no.
    jest.setSystemTime(new Date('2026-10-08T16:00:00.000Z'));

    const base =
      '/pedidos-b2b/export-xlsx?estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false&desde=2026-10-05&hasta=2026-10-05';
    const { libro } = await descargar(apiRol(s.h, s.base, 'GERENTE'), base);
    expect(libro.worksheets.map((h) => h.name)).toStrictEqual([
      'Pedidos',
      'Entregas',
    ]);
    const hoja = libro.getWorksheet('Entregas')!;
    // Columnas de Pedidos activos definidas por producto: sin Folio, Código del cliente ni Cerrada el; el importe se abre
    // en Subtotal / Descuento / Total.
    expect((hoja.getRow(1).values as string[]).slice(1)).toStrictEqual([
      'Negocio',
      'Fecha de entrega',
      'Día',
      'Estado de la entrega',
      'Piezas',
      'Subtotal',
      'Descuento',
      'Total',
      'Nota de la entrega',
    ]);
    const f = filas(hoja);
    expect(
      f.map((r) => [
        (r['Fecha de entrega'] as Date).toISOString().slice(0, 10),
        r['Día'],
        r['Negocio'],
        r['Estado de la entrega'],
        r['Piezas'],
        r['Subtotal'],
      ]),
    ).toStrictEqual([
      ['2026-10-05', 'Lun', 'Abarrotes Uno', 'Entregada', 6, 270],
      ['2026-10-05', 'Lun', 'Cafetería Tres', 'Atrasada', 6, 270],
      ['2026-10-07', 'Mié', 'Abarrotes Uno', 'Atrasada', 6, 270],
      ['2026-10-07', 'Mié', 'Cafetería Tres', 'Atrasada', 6, 270],
      ['2026-10-09', 'Vie', 'Abarrotes Uno', 'Pendiente', 4, 122],
      ['2026-10-09', 'Vie', 'Cafetería Tres', 'Pendiente', 4, 122],
    ]); // Bodega Dos (cancelado) no sale
    for (const r of f) {
      expect(typeof r['Piezas']).toBe('number');
      // Pedido sin descuento: Descuento = 0 y Total = Subtotal.
      expect(r['Descuento']).toBe(0);
      expect(r['Total']).toBe(r['Subtotal']);
    }

    // Coincide con la vista del panel: Σ precio × cantidad de cada día en GET /pedidos-b2b/:id.
    const panel = (await dueno().get(`/pedidos-b2b/${a.id}`).expect(200)).body;
    for (const e of panel.entregas as { dia: string; fecha: string }[]) {
      const importe = (
        panel.items as {
          precioUnitario: string;
          distribucion: { dia: string; cantidad: number }[];
        }[]
      ).reduce(
        (n, i) =>
          n +
          Number(i.precioUnitario) *
            (i.distribucion.find((d) => d.dia === e.dia)?.cantidad ?? 0),
        0,
      );
      const fila = f.find(
        (r) =>
          r['Negocio'] === 'Abarrotes Uno' &&
          (r['Fecha de entrega'] as Date).toISOString().slice(0, 10) ===
            e.fecha.slice(0, 10),
      )!;
      expect(fila['Subtotal']).toBe(importe);
    }

    // Filtros de Pedidos activos: negocio, pago y estado reducen AMBAS hojas.
    const porNegocio = (await descargar(dueno(), `${base}&negocioNombre=cafet`))
      .libro;
    expect(
      filas(porNegocio.getWorksheet('Pedidos')!).map((r) => r['Negocio']),
    ).toStrictEqual(['Cafetería Tres']);
    expect(
      new Set(
        filas(porNegocio.getWorksheet('Entregas')!).map((r) => r['Negocio']),
      ),
    ).toStrictEqual(new Set(['Cafetería Tres']));
    const porEstado = (
      await descargar(
        dueno(),
        '/pedidos-b2b/export-xlsx?estados=EN_PROCESO&cancelado=false&desde=2026-10-05&hasta=2026-10-05',
      )
    ).libro;
    expect(
      filas(porEstado.getWorksheet('Pedidos')!).map((r) => r['Negocio']),
    ).toStrictEqual(['Abarrotes Uno']);
    expect(filas(porEstado.getWorksheet('Entregas')!)).toHaveLength(3);

    // Pedidos vacío ⇒ Entregas existe, vacía y con encabezados.
    const vacio = (await descargar(dueno(), `${base}&estadoPago=PAGADO`)).libro;
    expect(filas(vacio.getWorksheet('Pedidos')!)).toHaveLength(0);
    const hojaVacia = vacio.getWorksheet('Entregas')!;
    expect(filas(hojaVacia)).toHaveLength(0);
    expect((hojaVacia.getRow(1).values as string[]).slice(1)[0]).toBe('Negocio');
  });

  const ENCABEZADOS_PEDIDOS_ACTIVOS = [
    'Negocio',
    'Semana (inicio)',
    'Semana (fin)',
    'Fecha de creación',
    'Estado del pedido',
    'Estado de pago',
    'Entregas',
    'Piezas',
    'Subtotal',
    'Descuento %',
    'Descuento $',
    'Total',
    'Nota del cliente',
  ];
  const RUTA_ACTIVOS =
    '/pedidos-b2b/export-xlsx?estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false&desde=2026-10-05&hasta=2026-10-05';
  const encabezados = (hoja: ExcelJS.Worksheet) =>
    (hoja.getRow(1).values as string[]).slice(1);

  it('Pedidos activos: columnas exactas y en orden de ambas hojas (formatos de moneda intactos)', async () => {
    await escenario();
    const { libro } = await descargar(dueno(), RUTA_ACTIVOS);
    expect(libro.worksheets.map((h) => h.name)).toStrictEqual(['Pedidos', 'Entregas']);
    expect(encabezados(libro.getWorksheet('Pedidos')!)).toStrictEqual(ENCABEZADOS_PEDIDOS_ACTIVOS);
    expect(encabezados(libro.getWorksheet('Entregas')!)).toStrictEqual([
      'Negocio',
      'Fecha de entrega',
      'Día',
      'Estado de la entrega',
      'Piezas',
      'Subtotal',
      'Descuento',
      'Total',
      'Nota de la entrega',
    ]);
    const entregas = libro.getWorksheet('Entregas')!;
    for (const col of [6, 7, 8]) expect(entregas.getRow(2).getCell(col).numFmt).toContain('$');
    const pedidos = libro.getWorksheet('Pedidos')!;
    for (const col of [9, 11, 12]) expect(pedidos.getRow(2).getCell(col).numFmt).toContain('$');
  });

  it('Pedidos activos · Piezas excluye las de entregas canceladas (cuadra con la hoja «Entregas»); «Entregas» cuenta todas', async () => {
    const { a } = await escenario();
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    const detalle = (await dueno().get(`/pedidos-b2b/${a.id}`).expect(200)).body;
    await dueno()
      .patch(`/pedidos-b2b/${a.id}/entregas/${detalle.entregas[0].id}/cerrar`)
      .send({ estado: 'ENTREGADA' })
      .expect(200);
    await dueno().patch(`/pedidos-b2b/${a.id}/cancelar`).expect(200); // las 2 pendientes pasan a Canceladas; la cerrada se conserva

    // Sin el filtro cancelado=false entra el pedido cancelado.
    const { libro } = await descargar(
      dueno(),
      '/pedidos-b2b/export-xlsx?desde=2026-10-05&hasta=2026-10-05',
    );
    const fila = filas(libro.getWorksheet('Pedidos')!).find((r) => r['Negocio'] === 'Abarrotes Uno')!;
    expect(fila['Estado del pedido']).toBe('Cancelado');
    // Motivo del cambio: Piezas ahora excluye las canceladas. El pedido tenía 16; las 2 entregas pendientes (6 + 4 piezas) se
    // cancelaron y queda la cerrada (6).
    expect(detalle.totalPiezas).toBe(16);
    expect(fila['Piezas']).toBe(6);
    expect(fila['Entregas']).toBe(3); // las 3 entregas del pedido (2 canceladas + 1 cerrada)
    // La hoja Entregas solo trae la no cancelada: 6 piezas.
    const hoja = filas(libro.getWorksheet('Entregas')!).filter((r) => r['Negocio'] === 'Abarrotes Uno');
    expect(hoja.map((r) => r['Piezas'])).toStrictEqual([6]);
    // Cuadra: Piezas del pedido = suma de Piezas de sus entregas en la hoja «Entregas».
    expect(hoja.reduce((n, r) => n + (r['Piezas'] as number), 0)).toBe(fila['Piezas']);
  });

  it('Pedidos activos · sin entregas canceladas, Piezas es el total del pedido (no cambia)', async () => {
    const { a } = await escenario();
    const { libro } = await descargar(dueno(), RUTA_ACTIVOS);
    const fila = filas(libro.getWorksheet('Pedidos')!).find((r) => r['Negocio'] === 'Abarrotes Uno')!;
    const detalle = (await dueno().get(`/pedidos-b2b/${a.id}`).expect(200)).body;
    expect(fila['Piezas']).toBe(detalle.totalPiezas);
    expect(fila['Piezas']).toBe(16);
  });

  it('Pedidos activos · el descuento del pedido se reparte entre sus entregas y la suma cuadra EXACTA al redondear', async () => {
    // Precios de 33.33: subtotal 533.28 (199.98 + 199.98 + 133.32); 5 % = 26.664 → 26.66; proporcional da 26.67 (10.00 + 10.00 + 6.67):
    // sobra 1 centavo, que se descuenta de UNA sola entrega: la de mayor importe, y si empatan, la más reciente (miércoles).
    await s.h.prisma.product.updateMany({
      where: { id: { in: [s.base.productoA.id, s.base.productoB.id] } },
      data: { precio: '33.33' },
    });
    const p = await crearAdminB2b(s.h, s.base, { negocioNombre: 'Con Descuento', descuentoPorcentaje: 5 });
    expect(Number(p.descuentoTotal)).toBe(26.66);

    const { libro } = await descargar(dueno(), RUTA_ACTIVOS);
    const f = filas(libro.getWorksheet('Entregas')!);
    expect(f.map((r) => [r['Día'], r['Subtotal'], r['Descuento'], r['Total']])).toStrictEqual([
      ['Lun', 199.98, 10, 189.98],
      ['Mié', 199.98, 9.99, 189.99],
      ['Vie', 133.32, 6.67, 126.65],
    ]);
    const suma = (k: string) => Math.round(f.reduce((n, r) => n + (r[k] as number), 0) * 100) / 100;
    expect(suma('Descuento')).toBe(26.66);
    expect(suma('Subtotal')).toBe(533.28);
    expect(suma('Total')).toBe(506.62);
    const pedido = filas(libro.getWorksheet('Pedidos')!)[0];
    expect(pedido['Descuento $']).toBe(26.66);
    expect(pedido['Total']).toBe(506.62);
    expect(pedido['Descuento %']).toBe(5);
    // Cada fila: Total = Subtotal − Descuento.
    for (const r of f) expect(Math.round(((r['Subtotal'] as number) - (r['Descuento'] as number)) * 100) / 100).toBe(r['Total']);
  });

  it('Pedidos activos · orden de la hoja Entregas: fecha, negocio y, si empatan (mismo negocio y fecha), folio ascendente', async () => {
    const itemsLunes = (cantidad: number) => [
      { productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad }] },
    ];
    // Dos pedidos del MISMO negocio y la MISMA fecha (clientes distintos con igual nombre): el de menor folio (el primero creado) va antes.
    await crearAdminB2b(s.h, s.base, { negocioNombre: 'Mismo Negocio', contactoTelefono: '5511000010', items: itemsLunes(6) });
    await crearAdminB2b(s.h, s.base, { negocioNombre: 'Mismo Negocio', contactoTelefono: '5511000011', items: itemsLunes(3) });
    await crearAdminB2b(s.h, s.base, { negocioNombre: 'Aaa Primero', contactoTelefono: '5511000012', items: itemsLunes(1) });
    const { libro } = await descargar(dueno(), RUTA_ACTIVOS);
    const f = filas(libro.getWorksheet('Entregas')!);
    // Mismo día: primero el negocio por orden alfabético; luego, entre los empatados, folio ascendente (6 piezas antes que 3).
    expect(f.map((r) => [r['Negocio'], r['Piezas']])).toStrictEqual([
      ['Aaa Primero', 1],
      ['Mismo Negocio', 6],
      ['Mismo Negocio', 3],
    ]);
  });

  it('Históricos · columnas exactas y en orden de ambas hojas; Pedidos activos conserva las suyas', async () => {
    const { a, b } = await escenario();
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    await cerrarEntregasB2b(dueno(), a.id);
    await dueno().patch(`/pedidos-b2b/${b.id}/cancelar`).expect(200);
    const { libro } = await descargar(dueno(), '/pedidos-b2b/export-xlsx?vista=HISTORICOS');
    expect(libro.worksheets.map((h) => h.name)).toStrictEqual(['Pedidos', 'Entregas']);
    expect(encabezados(libro.getWorksheet('Pedidos')!)).toStrictEqual([
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
    // «Importe (antes de descuento)» se conserva; no se divide en subtotal/descuento/total como en Pedidos activos.
    expect(encabezados(libro.getWorksheet('Entregas')!)).toStrictEqual([
      'Negocio',
      'Fecha de entrega',
      'Día',
      'Estado de la entrega',
      'Piezas',
      'Importe (antes de descuento)',
      'Nota de la entrega',
    ]);
    const activos = (await descargar(dueno(), RUTA_ACTIVOS)).libro;
    expect(encabezados(activos.getWorksheet('Pedidos')!)).toStrictEqual(ENCABEZADOS_PEDIDOS_ACTIVOS);
  });

  it('Históricos · siguen saliendo las entregas ya cerradas (Entregada / No recogida) de un pedido cancelado', async () => {
    const { a } = await escenario();
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    const detalle = (await dueno().get(`/pedidos-b2b/${a.id}`).expect(200)).body;
    await dueno()
      .patch(`/pedidos-b2b/${a.id}/entregas/${detalle.entregas[0].id}/cerrar`)
      .send({ estado: 'ENTREGADA' })
      .expect(200);
    await dueno()
      .patch(`/pedidos-b2b/${a.id}/entregas/${detalle.entregas[1].id}/cerrar`)
      .send({ estado: 'NO_RECOGIDA' })
      .expect(200);
    await dueno().patch(`/pedidos-b2b/${a.id}/cancelar`).expect(200); // queda la tercera (pendiente) cancelada
    const { libro } = await descargar(dueno(), '/pedidos-b2b/export-xlsx?vista=HISTORICOS&cancelado=true');
    const pedido = filas(libro.getWorksheet('Pedidos')!)[0];
    expect(pedido['Estado del pedido']).toBe('Cancelado');
    expect(
      filas(libro.getWorksheet('Entregas')!).map((r) => [r['Negocio'], r['Estado de la entrega']]),
    ).toStrictEqual([
      ['Abarrotes Uno', 'Entregada'],
      ['Abarrotes Uno', 'No recogida'],
    ]);
  });

  it('los 3 roles pueden exportar los tres archivos', async () => {
    await escenario();
    for (const rol of ['OPERADOR', 'GERENTE', 'DUENO'] as const) {
      for (const ruta of [
        '/pedidos-b2b/dia/2026-10-05/export-xlsx',
        '/pedidos-b2b/export-xlsx',
        '/pedidos-b2b/export-xlsx?vista=HISTORICOS',
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
