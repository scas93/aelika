import ExcelJS from 'exceljs';
import { usarSuite } from './helpers';
import { crearAdminB2b, SEMANA_ACTUAL, SEMANA_PASADA } from './b2b-helpers';
import { ResumenSemanalArmadoService } from '../../src/resumen-semanal/resumen-semanal-armado.service';
import { ResumenSemanalClienteEnvioService } from '../../src/resumen-semanal/resumen-semanal-cliente-envio.service';
import { ResumenSemanalClienteBarridoService } from '../../src/resumen-semanal/resumen-semanal-cliente-barrido.service';
import { ResumenSemanalBarridoService } from '../../src/resumen-semanal/resumen-semanal-barrido.service';
import { ResumenSemanalEnvioService } from '../../src/resumen-semanal/resumen-semanal-envio.service';

// Resumen semanal por cliente B2B: envío PROGRAMADO. Reloj de la suite: miércoles 2026-09-30 10:00 CDMX. El lunes 2026-10-05
// resume la semana 2026-09-28 (SEMANA_ACTUAL). Resend es un fake (fakes.correoEnviarConAdjuntos); nunca sale a la red.
const LUNES_0959 = '2026-10-05T15:59:00.000Z';
const LUNES_1000 = '2026-10-05T16:00:00.000Z';
const LUNES_1430 = '2026-10-05T20:30:00.000Z';
const MARTES_0000 = '2026-10-06T06:00:00.000Z';
const VIEJO = new Date('2026-09-01T00:00:00.000Z');

describe('Resumen semanal por cliente · envío programado (mayoreo)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const ir = (iso: string) => jest.setSystemTime(new Date(iso));
  const enviar = () => s.h.fakes.correoEnviarConAdjuntos;
  const servicios = () => {
    const armado = new ResumenSemanalArmadoService(s.h.prisma);
    const envio = new ResumenSemanalClienteEnvioService(s.h.prisma, armado, {
      enviarConAdjuntos: enviar(),
    } as any);
    jest.spyOn(envio as any, 'esperar').mockResolvedValue(undefined);
    const barrido = new ResumenSemanalClienteBarridoService(s.h.prisma, envio, {
      get: () => '0',
    } as any);
    return { envio, barrido, armado };
  };

  /** Interruptor general: canal Correo (inactivo, como nace) + evento RESUMEN_SEMANAL / CLIENTE. */
  const habilitarNegocio = async (activo = true, tenantId = s.base.tenant.id) => {
    const canal = await s.h.prisma.notificacionCanalConfig.create({
      data: { tenantId, tipo: 'CORREO', config: { nombreRemitente: 'Interno', correos: [] }, activo: false },
    });
    return s.h.prisma.notificacionEventoConfig.create({
      data: { tenantId, evento: 'RESUMEN_SEMANAL', audiencia: 'CLIENTE', canalConfigId: canal.id, activo },
    });
  };
  /** Cliente B2B con (o sin) pedido en la semana, y su resumen configurado. */
  const cliente = async (
    nombre: string,
    o: {
      correo?: string | null;
      activo?: boolean;
      semana?: string;
      pedido?: boolean;
      activadoAt?: Date | null;
      baja?: boolean;
    } = {},
  ) => {
    const semana = o.semana ?? SEMANA_ACTUAL;
    let clienteId: string;
    let folio: string | null = null;
    if (o.pedido === false) {
      const ref = await crearAdminB2b(s.h, s.base, { negocioNombre: nombre, semanaInicio: SEMANA_PASADA });
      const orden = await s.h.prisma.order.findUniqueOrThrow({ where: { id: ref.id } });
      clienteId = orden.clienteId!;
      await s.h.prisma.order.delete({ where: { id: ref.id } });
    } else {
      const p = await crearAdminB2b(s.h, s.base, { negocioNombre: nombre, semanaInicio: semana });
      clienteId = (await s.h.prisma.order.findUniqueOrThrow({ where: { id: p.id } })).clienteId!;
      folio = p.folio;
    }
    await s.h.prisma.cliente.update({
      where: { id: clienteId },
      data: {
        resumenSemanalActivo: o.activo ?? true,
        resumenSemanalCorreo: o.correo === undefined ? `${nombre.toLowerCase().replace(/\W/g, '')}@example.com` : o.correo,
        resumenSemanalActivadoAt: o.activadoAt === undefined ? VIEJO : o.activadoAt,
        bajaAt: o.baja ? new Date('2026-09-10T00:00:00Z') : null,
      },
    });
    return { id: clienteId, folio: folio! };
  };
  const marcas = () => s.h.prisma.resumenSemanalClienteEnvio.findMany({ orderBy: { createdAt: 'asc' } });
  const destinos = () => enviar().mock.calls.map((c) => c[0].destinatarios[0]);

  it('lunes 10:00 CDMX: un correo por cliente a SU correo, remitente = negocio, sin pago ni descuento, con su Excel', async () => {
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { nombre: 'Panadería Ñandú' } });
    await habilitarNegocio();
    const a = await cliente('Café Aurora', { correo: 'compras@aurora.test' });
    const { barrido } = servicios();
    expect((await barrido.ejecutar()).enVentana).toBe(false);
    ir(LUNES_0959);
    await barrido.ejecutar();
    expect(enviar()).not.toHaveBeenCalled();

    ir(LUNES_1000);
    const stats = await barrido.ejecutar();
    expect(stats).toMatchObject({ enVentana: true, negocios: 1, enviados: 1, fallidos: 0 });
    const arg = enviar().mock.calls[0][0];
    expect(arg.destinatarios).toEqual(['compras@aurora.test']);
    expect(arg.nombreRemitente).toBe('Panadería Ñandú');
    expect(arg.replyTo).toBeUndefined();
    expect(arg.mensaje.asunto).toBe('Tus pedidos con Panadería Ñandú: 28 de septiembre al 4 de octubre');
    expect(arg.mensaje.texto).toContain(`Pedido ${a.folio}`);
    expect(arg.mensaje.texto + arg.mensaje.html).not.toMatch(/pago|cobranza|descuento/i);
    expect(arg.adjuntos[0].nombreArchivo).toBe('Pedidos Panadería Ñandú 2026-09-28 al 2026-10-04.xlsx');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(arg.adjuntos[0].contenido);
    expect(libro.worksheets.map((w) => w.name)).toEqual(['Pedidos', 'Entregas']);
    const encabezados = (n: string) => (libro.getWorksheet(n)!.getRow(1).values as string[]).join('|');
    expect(encabezados('Pedidos')).not.toMatch(/pago|Descuento|Subtotal/i);
    expect(encabezados('Entregas')).not.toMatch(/pago|Descuento|Subtotal/i);
    expect(libro.getWorksheet('Pedidos')!.rowCount).toBe(2); // encabezado + su pedido
    // CAMBIO A PROPÓSITO (contenido del Excel al cliente): sin columnas de estado ni conteos por estado; Entregas una fila por producto.
    expect(encabezados('Pedidos')).not.toMatch(/Estado|Entregadas|No recogidas|Canceladas|Atrasada/i);
    expect(encabezados('Pedidos')).toContain('Entregas totales');
    expect(encabezados('Entregas')).toBe('|Folio|Fecha de entrega|Día|Producto|Unidades|Monto|Nota de la entrega');
    expect(encabezados('Entregas')).not.toMatch(/Estado/i);
    const todo: string[] = [libro.creator ?? '', libro.lastModifiedBy ?? '', libro.company ?? '', libro.title ?? ''];
    libro.eachSheet((w) => w.eachRow((r) => r.eachCell((c) => todo.push(String(c.value ?? '')))));
    expect(todo.join('\n')).not.toMatch(/aelika|atrasada/i);
    expect(arg.mensaje.texto + arg.mensaje.html + arg.mensaje.asunto + arg.adjuntos[0].nombreArchivo).not.toMatch(/aelika/i);
    const m = await marcas();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ clienteId: a.id, estado: 'EXITO', motivo: null });
  });

  it('Reply-To: el correo de respuestas del negocio, cuando existe', async () => {
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { correoRespuestas: 'ventas@negocio.test' } });
    await habilitarNegocio();
    await cliente('Cliente Uno');
    ir(LUNES_1000);
    await servicios().barrido.ejecutar();
    expect(enviar().mock.calls[0][0].replyTo).toBe('ventas@negocio.test');
  });

  it('dos clientes con el MISMO nombre comercial: cada uno recibe solo lo suyo', async () => {
    await habilitarNegocio();
    const a = await cliente('Café Gemelo', { correo: 'a@gemelo.test' });
    const b = await cliente('Café Gemelo', { correo: 'b@gemelo.test' });
    ir(LUNES_1000);
    await servicios().barrido.ejecutar();
    expect(enviar()).toHaveBeenCalledTimes(2);
    for (const [c, otro, correo] of [[a, b, 'a@gemelo.test'], [b, a, 'b@gemelo.test']] as const) {
      const arg = enviar().mock.calls.map((x) => x[0]).find((x) => x.destinatarios[0] === correo)!;
      expect(arg.mensaje.texto).toContain(`Pedido ${c.folio}`);
      expect(arg.mensaje.texto).not.toContain(`Pedido ${otro.folio} `);
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.load(arg.adjuntos[0].contenido);
      expect(libro.getWorksheet('Pedidos')!.rowCount).toBe(2);
    }
  });

  it('solo recibe quien cumple TODO; el resto se omite sin registro', async () => {
    await habilitarNegocio();
    await cliente('Cumple', { correo: 'ok@x.test' });
    await cliente('Interruptor apagado', { activo: false });
    await cliente('Sin correo', { correo: null });
    await cliente('De baja', { baja: true });
    await cliente('Sin pedidos', { pedido: false });
    await cliente('Otra semana', { semana: SEMANA_PASADA });
    ir(LUNES_1000);
    const stats = await servicios().barrido.ejecutar();
    expect(destinos()).toEqual(['ok@x.test']);
    expect(stats).toMatchObject({ enviados: 1, fallidos: 0, omitidos: 0 });
    expect(await marcas()).toHaveLength(1);
  });

  it('interruptor general apagado, negocio sin clientes habilitados o que ya no es de mayoreo: no hace nada', async () => {
    const ev = await habilitarNegocio(false);
    await cliente('Uno');
    const { barrido } = servicios();
    ir(LUNES_1000);
    expect((await barrido.ejecutar()).negocios).toBe(0);
    await s.h.prisma.notificacionEventoConfig.update({ where: { id: ev.id }, data: { activo: true, updatedAt: VIEJO } as any });
    await s.h.prisma.cliente.updateMany({ data: { resumenSemanalActivo: false } });
    expect((await barrido.ejecutar()).enviados).toBe(0);
    await s.h.prisma.cliente.updateMany({ data: { resumenSemanalActivo: true } });
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { tipoStorefront: 'RETAIL_B2C' } });
    expect((await barrido.ejecutar()).negocios).toBe(0);
    expect(enviar()).not.toHaveBeenCalled();
  });

  it('cliente con solo pedidos cancelados: recibe el correo con el pedido marcado Cancelado y totales en cero', async () => {
    await habilitarNegocio();
    const a = await cliente('Cancelador');
    await s.h.prisma.order.updateMany({ where: { clienteId: a.id }, data: { cancelado: true } });
    ir(LUNES_1000);
    await servicios().barrido.ejecutar();
    expect(enviar()).toHaveBeenCalledTimes(1);
    const texto = enviar().mock.calls[0][0].mensaje.texto as string;
    expect(texto).toContain(`Pedido ${a.folio} · Cancelado`);
    expect(texto).toContain('están cancelados');
    expect(texto).toContain('Total: $0.00');
  });

  describe('activación no retroactiva', () => {
    it('interruptor general encendido DESPUÉS de las 10:00 del lunes: ese lunes no sale; el siguiente sí', async () => {
      const ev = await habilitarNegocio(false);
      await cliente('Uno');
      ir(LUNES_1430);
      await s.h.prisma.notificacionEventoConfig.update({ where: { id: ev.id }, data: { activo: true } });
      const { barrido } = servicios();
      await barrido.ejecutar();
      expect(enviar()).not.toHaveBeenCalled();
      // Lunes siguiente: su pedido es de la semana 2026-10-05.
      await cliente('Dos', { semana: '2026-10-05', activadoAt: VIEJO, correo: 'dos@x.test' });
      ir('2026-10-12T16:00:00.000Z');
      await barrido.ejecutar();
      expect(destinos()).toContain('dos@x.test');
    });

    it('interruptor del cliente encendido después de las 10:00 del lunes: ese lunes no sale', async () => {
      await habilitarNegocio();
      await cliente('Tarde', { activadoAt: new Date(LUNES_1430) });
      await cliente('A tiempo', { activadoAt: new Date('2026-10-05T15:00:00.000Z'), correo: 'ok@x.test' });
      ir(LUNES_1430);
      await servicios().barrido.ejecutar();
      expect(destinos()).toEqual(['ok@x.test']);
    });
  });

  describe('duplicados', () => {
    it('misma ventana varias veces y cambio de correo tras el envío: un solo correo por cliente y semana', async () => {
      await habilitarNegocio();
      const a = await cliente('Uno', { correo: 'viejo@x.test' });
      const { barrido } = servicios();
      ir(LUNES_1000);
      await barrido.ejecutar();
      await s.h.prisma.cliente.update({ where: { id: a.id }, data: { resumenSemanalCorreo: 'nuevo@x.test' } });
      ir(LUNES_1430);
      await barrido.ejecutar();
      expect(destinos()).toEqual(['viejo@x.test']);
      ir(MARTES_0000);
      expect((await barrido.ejecutar()).enVentana).toBe(false);
    });

    it('dos ejecuciones simultáneas (dos instancias): un solo correo por cliente', async () => {
      await habilitarNegocio();
      await cliente('Uno');
      await cliente('Dos');
      ir(LUNES_1000);
      const x = servicios();
      const y = servicios();
      await Promise.all([x.barrido.ejecutar(), y.barrido.ejecutar()]);
      expect(enviar()).toHaveBeenCalledTimes(2);
      expect(await marcas()).toHaveLength(2);
    });

    it('el índice único de la base lo garantiza aunque se salte el barrido', async () => {
      await habilitarNegocio();
      const a = await cliente('Uno');
      const { envio } = servicios();
      const datos = { id: a.id, tenantId: s.base.tenant.id, nombre: 'Uno', correoResumen: 'u@x.test' };
      const negocio = { nombre: 'N', correoRespuestas: null };
      const semana = { inicio: SEMANA_ACTUAL, fin: '2026-10-04' };
      expect((await envio.enviarProgramado(datos, negocio, semana)).resultado).toBe('EXITO');
      expect((await envio.enviarProgramado(datos, negocio, semana)).resultado).toBe('DUPLICADO');
      expect(enviar()).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallos', () => {
    it('un fallo con un cliente no impide los demás, queda como FALLO sin direcciones y no se reintenta', async () => {
      await habilitarNegocio();
      await cliente('Uno', { correo: 'uno@x.test' });
      await cliente('Dos', { correo: 'dos@x.test' });
      enviar().mockResolvedValueOnce({ exito: false, error: 'Resend: buzón uno@x.test inválido' });
      const { barrido } = servicios();
      ir(LUNES_1000);
      expect(await barrido.ejecutar()).toMatchObject({ enviados: 1, fallidos: 1 });
      const m = await marcas();
      expect(m.map((x) => x.estado).sort()).toEqual(['EXITO', 'FALLO']);
      expect(m.find((x) => x.estado === 'FALLO')!.motivo).toBe('Resend: buzón ***@*** inválido');
      ir(LUNES_1430);
      await barrido.ejecutar();
      expect(enviar()).toHaveBeenCalledTimes(2); // sin reintento
    });

    it('si el armado lanza, queda FALLO y el barrido sigue', async () => {
      await habilitarNegocio();
      await cliente('Uno');
      const { barrido, armado } = servicios();
      jest.spyOn(armado, 'armarParaCliente').mockRejectedValueOnce(new Error('boom'));
      ir(LUNES_1000);
      expect(await barrido.ejecutar()).toMatchObject({ fallidos: 1, conError: 0 });
    });

    it('rechazo por exceso de tasa: se reintenta y el correo no se pierde', async () => {
      await habilitarNegocio();
      await cliente('Uno');
      enviar()
        .mockResolvedValueOnce({ exito: false, error: 'Resend: rate', limitadoPorTasa: true, reintentarEnSeg: 1 })
        .mockResolvedValueOnce({ exito: true });
      ir(LUNES_1000);
      expect(await servicios().barrido.ejecutar()).toMatchObject({ enviados: 1, fallidos: 0, diferidos: 0 });
      expect(enviar()).toHaveBeenCalledTimes(2);
      expect((await marcas())[0].estado).toBe('EXITO');
    });

    it('tasa persistente: se difiere sin marca y la siguiente ejecución del mismo lunes lo envía', async () => {
      await habilitarNegocio();
      await cliente('Uno', { correo: 'uno@x.test' });
      await cliente('Dos', { correo: 'dos@x.test' });
      enviar().mockResolvedValue({ exito: false, error: 'Resend: rate', limitadoPorTasa: true });
      const { barrido } = servicios();
      ir(LUNES_1000);
      expect(await barrido.ejecutar()).toMatchObject({ enviados: 0, fallidos: 0, diferidos: 1 });
      expect(await marcas()).toHaveLength(0);
      enviar().mockReset().mockResolvedValue({ exito: true });
      ir(LUNES_1430);
      expect(await barrido.ejecutar()).toMatchObject({ enviados: 2 });
      expect(await marcas()).toHaveLength(2);
    });
  });

  it('el resumen al negocio no cambia: ignora la audiencia CLIENTE y el de clientes no toca el del negocio', async () => {
    await habilitarNegocio();
    await cliente('Uno', { correo: 'uno@x.test' });
    const canal = await s.h.prisma.notificacionCanalConfig.findFirstOrThrow({ where: { tipo: 'CORREO' } });
    await s.h.prisma.notificacionCanalConfig.update({
      where: { id: canal.id },
      data: { activo: true, config: { nombreRemitente: 'Banetto', correos: ['equipo@x.test'] } },
    });
    await s.h.prisma.notificacionEventoConfig.create({
      data: { tenantId: s.base.tenant.id, evento: 'RESUMEN_SEMANAL', audiencia: 'NEGOCIO', canalConfigId: canal.id, activo: true },
    });
    const { barrido, envio } = servicios();
    const armado = new ResumenSemanalArmadoService(s.h.prisma);
    const envioNegocio = new ResumenSemanalEnvioService(s.h.prisma, armado, { enviarConAdjuntos: enviar() } as any);
    const barridoNegocio = new ResumenSemanalBarridoService(s.h.prisma, envioNegocio);
    void envio;
    ir(LUNES_1000);
    expect(await barridoNegocio.ejecutar()).toMatchObject({ negocios: 1, enviados: 1 });
    expect(destinos()).toEqual(['equipo@x.test']);
    expect(await barrido.ejecutar()).toMatchObject({ negocios: 1, enviados: 1 });
    expect(destinos()).toEqual(['equipo@x.test', 'uno@x.test']);
    expect(await s.h.prisma.resumenSemanalEnvio.count()).toBe(1);
    expect(await marcas()).toHaveLength(1);
  });
});
