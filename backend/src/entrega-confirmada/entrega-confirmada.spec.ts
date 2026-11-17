import ExcelJS from 'exceljs';
import {
  construirCorreoEntregaConfirmada,
  datosEntregaConfirmada,
  type PedidoParaEntregaConfirmada,
} from './entrega-confirmada';
import { EntregaConfirmadaService } from './entrega-confirmada.service';
import {
  libroResumenCliente,
  type LineaEntregaCliente,
} from '../resumen-semanal/resumen-semanal-cliente-datos';
import type { FilaPedidoExcel } from '../pedidos-b2b/pedidos-b2b-excel';
import { resolverEntregaConfirmada } from '../clientes-b2b/clientes-b2b.service';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const item = (producto: string, cantidad: number, precio: string) => ({
  cantidad,
  orderItem: { nombreProducto: producto, precioUnitario: precio },
});

// Tres entregas con importes que NO reparten exacto el descuento (el centavo que sobra importa).
function pedido(descuento: boolean): PedidoParaEntregaConfirmada {
  return {
    total: descuento ? '299.97' : '333.30',
    descuentoTotal: descuento ? '33.33' : '0',
    detalleB2b: { descuentoPorcentajeAplicado: descuento ? '10' : null },
    entregas: [
      { id: 'e-b', estado: 'ENTREGADA', fecha: d('2026-11-18'), items: [item('Concha', 7, '12.33'), item('Bolillo', 3, '4.50')] },
      { id: 'e-a', estado: 'PENDIENTE', fecha: d('2026-11-17'), items: [item('Pan de muerto', 5, '18.17')] },
      { id: 'e-c', estado: 'ENTREGADA', fecha: d('2026-11-19'), items: [item('Cuernito', 11, '9.99')] },
      { id: 'e-x', estado: 'CANCELADA', fecha: d('2026-11-20'), items: [item('Dona', 4, '10')] },
    ],
  } as PedidoParaEntregaConfirmada;
}

describe('datosEntregaConfirmada', () => {
  it('sin descuento: líneas exactas y total = subtotal', () => {
    const r = datosEntregaConfirmada(pedido(false), 'e-b')!;
    expect(r.lineas).toEqual([
      { producto: 'Bolillo', unidades: 3, precio: 4.5, monto: 13.5 },
      { producto: 'Concha', unidades: 7, precio: 12.33, monto: 86.31 },
    ]);
    expect(r.descuento).toBe(0);
    expect(r.subtotal).toBe(99.81);
    expect(r.total).toBe(99.81);
  });

  it('entrega cancelada o inexistente: null', () => {
    expect(datosEntregaConfirmada(pedido(true), 'e-x')).toBeNull();
    expect(datosEntregaConfirmada(pedido(true), 'nope')).toBeNull();
  });

  it('con descuento: Σ totales de entrega = Total del pedido y coincide con el Excel del resumen por cliente', async () => {
    const p = pedido(true);
    const ids = ['e-a', 'e-b', 'e-c'];
    const datos = ids.map((id) => datosEntregaConfirmada(p, id)!);
    expect(
      Math.round(datos.reduce((s, x) => s + x.total * 100, 0)),
    ).toBe(29997);
    expect(datos.every((x) => x.porcentaje === 10)).toBe(true);

    // El Excel del resumen por cliente, armado con los mismos datos: «Total de la entrega» por entrega, en orden de fecha.
    const lineas: LineaEntregaCliente[] = p.entregas
      .filter((e) => e.estado !== 'CANCELADA')
      .flatMap((e) =>
        e.items.map((i) => ({
          folio: 'B-1',
          entregaId: e.id,
          fecha: e.fecha,
          producto: i.orderItem.nombreProducto,
          unidades: i.cantidad,
          precio: Number(i.orderItem.precioUnitario),
          montoLista: Math.round(i.cantidad * Number(i.orderItem.precioUnitario) * 100) / 100,
          monto: 0,
          nota: null,
        })),
      );
    const fila = {
      folio: 'B-1',
      clienteCodigo: 'c',
      negocioNombre: 'N',
      semanaInicio: d('2026-11-16'),
      notaCliente: null,
      createdAt: d('2026-11-10'),
      estado: 'CONFIRMADO_SURTIENDO',
      cancelado: false,
      estadoPago: 'PENDIENTE',
      pagadoAt: null,
      estadosEntregas: [],
      totalPiezas: 0,
      subtotal: 333.3,
      descuentoPorcentaje: 10,
      descuentoTotal: 33.33,
      total: 299.97,
    } as unknown as FilaPedidoExcel;
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await libroResumenCliente([fila], lineas)) as never);
    const hoja = libro.getWorksheet('Entregas')!;
    const totalesExcel: number[] = [];
    const descuentosExcel: number[] = [];
    hoja.eachRow((r) => {
      if (r.getCell(1).value === 'Total de la entrega')
        totalesExcel.push(Number(r.getCell(4).value));
      if (String(r.getCell(1).value).startsWith('Descuento (') && r.getCell(1).alignment?.indent === 1)
        descuentosExcel.push(Number(r.getCell(4).value));
    });
    expect(totalesExcel).toEqual(datos.map((x) => x.total));
    expect(descuentosExcel).toEqual(datos.map((x) => x.descuento));
  });
});

describe('construirCorreoEntregaConfirmada', () => {
  const base = datosEntregaConfirmada(pedido(true), 'e-b')!;

  it('asunto con la fecha, tabla, cierre con descuento y pie; sin Aelika, pago ni Atrasada', () => {
    const c = construirCorreoEntregaConfirmada('Panadería Banetto', 'Café Ñandú', base);
    expect(c.asunto).toBe('Entrega confirmada · miércoles 18 de noviembre');
    for (const t of [c.texto, c.html]) {
      expect(t).toContain('Panadería Banetto');
      expect(t).toContain('Concha');
      expect(t).toContain('Subtotal');
      expect(t).toContain('Descuento (10%)');
      expect(t).toContain('Total de la entrega');
      expect(t).toContain('comunícate con alguien del equipo de Panadería Banetto');
      expect(t.toLowerCase()).not.toContain('aelika');
      expect(t.toLowerCase()).not.toContain('atrasada');
      expect(t.toLowerCase()).not.toContain('pago');
    }
    expect(c.html).toContain('Precio unitario');
    expect(c.html).toContain('Unidades');
  });

  it('sin descuento solo muestra el Total de la entrega', () => {
    const sin = datosEntregaConfirmada(pedido(false), 'e-b')!;
    const c = construirCorreoEntregaConfirmada('Banetto', 'X', sin);
    expect(c.texto).toContain('Total de la entrega');
    expect(c.texto).not.toContain('Subtotal');
    expect(c.texto).not.toContain('Descuento');
  });

  it('escapa HTML del nombre del producto y del cliente', () => {
    const c = construirCorreoEntregaConfirmada('B', '<b>Hola</b>', {
      ...base,
      lineas: [{ producto: '<script>x</script>', unidades: 1, precio: 1, monto: 1 }],
    });
    expect(c.html).not.toContain('<script>');
    expect(c.html).not.toContain('<b>Hola</b>');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Servicio: disparo, no repetición, apagado y fallo de envío
// ---------------------------------------------------------------------------------------------------------------------

class ServicioSinEsperas extends EntregaConfirmadaService {
  protected esperar(): Promise<void> {
    return Promise.resolve();
  }
}

function montar(
  opciones: {
    entrega?: unknown;
    general?: boolean;
    cliente?: Partial<{ entregaConfirmadaActivo: boolean; resumenSemanalCorreo: string | null }>;
    envio?: unknown;
    unicos?: Set<string>;
  } = {},
) {
  const unicos = opciones.unicos ?? new Set<string>();
  const filas: Record<string, { estado: string; motivo: string | null }> = {};
  const prisma = {
    entrega: {
      findFirst: jest.fn().mockResolvedValue(
        opciones.entrega === undefined
          ? { estado: 'ENTREGADA', orderId: 'o1', order: { tipo: 'B2B', clienteId: 'c1' } }
          : opciones.entrega,
      ),
    },
    entregaConfirmadaEnvio: {
      create: jest.fn(async ({ data }: { data: { entregaId: string } }) => {
        if (unicos.has(data.entregaId)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        unicos.add(data.entregaId);
        filas[data.entregaId] = { estado: 'EN_CURSO', motivo: null };
        return { id: data.entregaId };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { estado: string; motivo: string | null } }) => {
        filas[where.id] = { estado: data.estado, motivo: data.motivo };
      }),
    },
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        nombre: 'Panadería Banetto',
        tipoStorefront: 'RETAIL_B2B',
        correoRespuestas: 'ventas@banetto.com',
      }),
    },
    notificacionEventoConfig: {
      findFirst: jest.fn().mockResolvedValue(opciones.general === false ? null : { id: 'g1' }),
    },
    cliente: {
      findFirst: jest.fn().mockResolvedValue({
        nombre: 'Café Ñandú',
        entregaConfirmadaActivo: true,
        resumenSemanalCorreo: 'cliente@cafe.com',
        ...opciones.cliente,
      }),
    },
    order: { findFirst: jest.fn().mockResolvedValue(pedido(true)) },
  };
  const correo = {
    enviarConAdjuntos: jest
      .fn()
      .mockResolvedValue(opciones.envio ?? { exito: true }),
  };
  const servicio = new ServicioSinEsperas(prisma as never, correo as never);
  return { servicio, prisma, correo, filas };
}

describe('EntregaConfirmadaService', () => {
  it('con ambos interruptores y correo envía exactamente un correo con el formato del negocio y lo registra', async () => {
    const { servicio, correo, filas } = montar();
    expect(await servicio.avisar('t1', 'e-b')).toEqual({ resultado: 'EXITO' });
    expect(correo.enviarConAdjuntos).toHaveBeenCalledTimes(1);
    const arg = correo.enviarConAdjuntos.mock.calls[0][0];
    expect(arg.destinatarios).toEqual(['cliente@cafe.com']);
    expect(arg.nombreRemitente).toBe('Panadería Banetto');
    expect(arg.replyTo).toBe('ventas@banetto.com');
    expect(arg.adjuntos).toBeUndefined();
    expect(arg.mensaje.asunto).toContain('Entrega confirmada');
    expect(filas['e-b'].estado).toBe('EXITO');
  });

  it('no se repite: la segunda vez que pasa a Entregada no envía', async () => {
    const { servicio, correo } = montar();
    await servicio.avisar('t1', 'e-b');
    expect(await servicio.avisar('t1', 'e-b')).toEqual({ resultado: 'DUPLICADO' });
    expect(correo.enviarConAdjuntos).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['interruptor general apagado', { general: false }],
    ['interruptor del cliente apagado', { cliente: { entregaConfirmadaActivo: false } }],
    ['cliente sin correo', { cliente: { resumenSemanalCorreo: null } }],
  ])('%s: no envía, se registra como omitido y no lanza', async (_n, op) => {
    const { servicio, correo, filas } = montar(op);
    const r = await servicio.avisar('t1', 'e-b');
    expect(r.resultado).toBe('OMITIDO');
    expect(correo.enviarConAdjuntos).not.toHaveBeenCalled();
    expect(filas['e-b'].estado).toBe('OMITIDO');
    // Encender algo después y volver a marcar tampoco envía una entrega vieja.
    expect(await servicio.avisar('t1', 'e-b')).toEqual({ resultado: 'DUPLICADO' });
  });

  it('entrega que no está Entregada, de B2C o inexistente: no aplica y no registra', async () => {
    for (const entrega of [
      { estado: 'NO_RECOGIDA', orderId: 'o1', order: { tipo: 'B2B', clienteId: 'c1' } },
      { estado: 'ENTREGADA', orderId: 'o1', order: { tipo: 'B2C', clienteId: 'c1' } },
      null,
    ]) {
      const { servicio, correo, prisma } = montar({ entrega });
      expect(await servicio.avisar('t1', 'e-b')).toEqual({ resultado: 'NO_APLICA' });
      expect(correo.enviarConAdjuntos).not.toHaveBeenCalled();
      expect(prisma.entregaConfirmadaEnvio.create).not.toHaveBeenCalled();
    }
  });

  it('fallo del correo: se registra FALLO con motivo sin direcciones y avisarSeguro no rechaza', async () => {
    const { servicio, filas } = montar({
      envio: { exito: false, error: 'rechazado para cliente@cafe.com' },
    });
    await expect(servicio.avisarSeguro('t1', 'e-b')).resolves.toBeUndefined();
    expect(filas['e-b'].estado).toBe('FALLO');
    expect(filas['e-b'].motivo).not.toContain('cliente@cafe.com');
  });

  it('el proveedor de correo lanzando una excepción tampoco rechaza y queda FALLO', async () => {
    const { servicio, correo, filas } = montar();
    correo.enviarConAdjuntos.mockRejectedValue(new Error('red caída'));
    await expect(servicio.avisarSeguro('t1', 'e-b')).resolves.toBeUndefined();
    expect(filas['e-b'].estado).toBe('FALLO');
  });

  it('un fallo de base de datos al disparar no rechaza', async () => {
    const { servicio, prisma } = montar();
    prisma.entrega.findFirst.mockRejectedValue(new Error('db caída'));
    await expect(servicio.avisarSeguro('t1', 'e-b')).resolves.toBeUndefined();
  });

  it('varias entregas a la vez: un correo por entrega, en fila', async () => {
    const { servicio, correo } = montar();
    await Promise.all(['e-a', 'e-b', 'e-c'].map((id) => servicio.avisarSeguro('t1', id)));
    expect(correo.enviarConAdjuntos).toHaveBeenCalledTimes(3);
  });

  it('reintenta si Resend limita por tasa y al final envía', async () => {
    const { servicio, correo, filas } = montar();
    correo.enviarConAdjuntos
      .mockResolvedValueOnce({ exito: false, error: '429', limitadoPorTasa: true })
      .mockResolvedValueOnce({ exito: true });
    expect((await servicio.avisar('t1', 'e-b')).resultado).toBe('EXITO');
    expect(correo.enviarConAdjuntos).toHaveBeenCalledTimes(2);
    expect(filas['e-b'].estado).toBe('EXITO');
  });

  describe('prueba', () => {
    it('envía a la dirección escrita sin registrar y con los interruptores apagados', async () => {
      const { servicio, prisma, correo } = montar({
        general: false,
        cliente: { entregaConfirmadaActivo: false, resumenSemanalCorreo: null },
      });
      prisma.entrega.findFirst.mockResolvedValue({ id: 'e-b', orderId: 'o1', fecha: d('2026-11-18') });
      const r = await servicio.enviarPrueba(
        't1',
        { id: 'c1', nombre: 'Café' },
        { nombre: 'Banetto', correoRespuestas: null },
        'Yo@Correo.com',
      );
      expect(r).toEqual({ resultado: 'EXITO', fechaEntrega: '2026-11-18' });
      expect(correo.enviarConAdjuntos.mock.calls[0][0].destinatarios).toEqual(['yo@correo.com']);
      expect(prisma.entregaConfirmadaEnvio.create).not.toHaveBeenCalled();
    });

    it('sin entregas entregadas responde SIN_ENTREGAS', async () => {
      const { servicio, prisma, correo } = montar();
      prisma.entrega.findFirst.mockResolvedValue(null);
      expect(
        await servicio.enviarPrueba('t1', { id: 'c1', nombre: 'C' }, { nombre: 'B', correoRespuestas: null }, 'a@b.co'),
      ).toEqual({ resultado: 'SIN_ENTREGAS' });
      expect(correo.enviarConAdjuntos).not.toHaveBeenCalled();
    });
  });
});

describe('resolverEntregaConfirmada (interruptor por cliente)', () => {
  it('sin cambios pedidos y con correo: no toca nada', () => {
    expect(resolverEntregaConfirmada(false, 'a@b.co', {})).toBeNull();
    expect(resolverEntregaConfirmada(true, 'a@b.co', {})).toBeNull();
  });
  it('enciende y apaga', () => {
    expect(resolverEntregaConfirmada(false, 'a@b.co', { entregaConfirmadaActivo: true })).toBe(true);
    expect(resolverEntregaConfirmada(true, 'a@b.co', { entregaConfirmadaActivo: false })).toBe(false);
  });
  it('sin correo: encenderlo es 400 y, si estaba encendido, se apaga solo', () => {
    expect(() => resolverEntregaConfirmada(false, null, { entregaConfirmadaActivo: true })).toThrow();
    expect(resolverEntregaConfirmada(true, null, {})).toBe(false);
    expect(resolverEntregaConfirmada(false, null, {})).toBeNull();
  });
});
