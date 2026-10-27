import { ReglaBarridoService } from '../../src/notificaciones-reglas/regla-barrido.service';
import { ReglaCandadoService } from '../../src/notificaciones-reglas/regla-candado.service';
import { ReglasFiltroService } from '../../src/notificaciones-reglas/reglas-filtro.service';
import { apiRol } from './b2b-helpers';
import { usarSuite } from './helpers';

const DIA_MS = 24 * 60 * 60 * 1000;

// Reglas ESTADO_CLIENTE: un cliente recibe la regla una sola vez mientras siga cumpliendo el filtro.
// El barrido es el REAL (ReglaBarridoService + filtro + candado reales sobre la base de pruebas); solo la frontera con
// Botpress (ReglaEnvioService.enviar) es un fake que deja una fila real en ReglaEnvioLog con el estado que se le indique.
describe('Reglas ESTADO_CLIENTE · deduplicación del barrido', () => {
  const s = usarSuite();
  let estadoEnvio: 'EXITO' | 'FALLO' | 'EN_CURSO' = 'EXITO';
  let barrido: ReglaBarridoService;
  const enviar = jest.fn();

  beforeEach(() => {
    estadoEnvio = 'EXITO';
    enviar.mockReset().mockImplementation(async (tenant, cliente, regla) =>
      s.h.prisma.reglaEnvioLog.create({
        data: {
          tenantId: tenant.id,
          clienteId: cliente.id,
          reglaId: regla.id,
          categoria: regla.plantillaCategoria,
          estado: estadoEnvio,
        },
      }),
    );
    barrido = new ReglaBarridoService(
      s.h.prisma,
      new ReglasFiltroService(s.h.prisma),
      new ReglaCandadoService(s.h.prisma),
      { enviar } as any,
    );
  });

  const SIN_COMPRAR_30 = [{ campo: 'ULTIMO_PEDIDO_ANTIGUEDAD_DIAS', operador: 'MAYOR_IGUAL', valor: 30 }];

  const crearRegla = (extra: Record<string, unknown> = {}) =>
    s.h.prisma.regla.create({
      data: {
        tenantId: s.base.tenant.id,
        nombre: 'Sin comprar',
        trigger: 'ESTADO_CLIENTE',
        filtro: SIN_COMPRAR_30,
        canal: 'WHATSAPP',
        plantillaNombre: 'te_extranamos',
        plantillaIdioma: 'es_MX',
        plantillaCategoria: 'UTILITY',
        plantillaVariables: [],
        activa: true,
        ...extra,
      } as any,
    });

  /** Cliente B2C cuyo último pedido fue hace `diasSinComprar` días (respecto del reloj de la prueba). */
  const crearCliente = (telefono: string, diasSinComprar: number) => {
    const ultimo = new Date(Date.now() - diasSinComprar * DIA_MS);
    return s.h.prisma.cliente.create({
      data: {
        tenantId: s.base.tenant.id,
        canal: 'B2C',
        telefono,
        nombre: `Cliente ${telefono}`,
        primerPedidoAt: ultimo,
        ultimoPedidoAt: ultimo,
        totalPedidos: 1,
      },
    });
  };
  const filasEstado = (reglaId: string) => s.h.prisma.reglaClienteEstado.count({ where: { reglaId } });

  it('dos barridos seguidos no reenvían: el segundo lo cuenta como omitido', async () => {
    const regla = await crearRegla();
    await crearCliente('5511110001', 40);

    const primero = await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(primero.enviosDisparados).toBe(1);

    const segundo = await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(segundo.enviosDisparados).toBe(0);
    expect(segundo.omitidosYaEnviado).toBe(1);
    expect(await filasEstado(regla.id)).toBe(1);
  });

  it('un cliente que deja de cumplir y vuelve a cumplir recibe de nuevo', async () => {
    const regla = await crearRegla();
    const cliente = await crearCliente('5511110001', 40);
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(1);

    // Vuelve a comprar: sale de la regla y su fila se borra, sin enviar nada.
    await s.h.prisma.cliente.update({ where: { id: cliente.id }, data: { ultimoPedidoAt: new Date() } });
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await filasEstado(regla.id)).toBe(0);

    // 31 días después sin comprar: la cumple otra vez.
    jest.setSystemTime(new Date(Date.now() + 31 * DIA_MS));
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(await filasEstado(regla.id)).toBe(1);
  });

  it('un FALLO es definitivo mientras el cliente siga cumpliendo, y se reintenta al volver a entrar', async () => {
    const regla = await crearRegla();
    const cliente = await crearCliente('5511110001', 40);
    estadoEnvio = 'FALLO';

    await barrido.ejecutarBarrido();
    await barrido.ejecutarBarrido();
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await filasEstado(regla.id)).toBe(1);

    await s.h.prisma.cliente.update({ where: { id: cliente.id }, data: { ultimoPedidoAt: new Date() } });
    await barrido.ejecutarBarrido();
    jest.setSystemTime(new Date(Date.now() + 31 * DIA_MS));
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it('EN_CURSO (sin callback) cuenta como enviado', async () => {
    await crearRegla();
    await crearCliente('5511110001', 40);
    estadoEnvio = 'EN_CURSO';
    await barrido.ejecutarBarrido();
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('un envío que ni siquiera pudo intentarse (enviar lanza) no se registra y se reintenta en el siguiente barrido', async () => {
    const regla = await crearRegla();
    await crearCliente('5511110001', 40);
    enviar.mockRejectedValueOnce(new Error('sin webhook'));

    const primero = await barrido.ejecutarBarrido();
    expect(primero.enviosConError).toBe(1);
    expect(await filasEstado(regla.id)).toBe(0);

    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(await filasEstado(regla.id)).toBe(1);
  });

  it('clientes nuevos que entran después sí reciben; los que ya estaban no', async () => {
    await crearRegla();
    await crearCliente('5511110001', 40);
    await barrido.ejecutarBarrido();
    await crearCliente('5511110002', 50);
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls.map((c) => c[1].telefono).sort()).toEqual(['5511110001', '5511110002']);
  });

  describe('llenado inicial (estadoBasePendiente, lo enciende la migración)', () => {
    it('el primer barrido registra a quienes ya cumplen sin enviar nada; después solo reciben los que entren', async () => {
      const regla = await crearRegla({ estadoBasePendiente: true });
      await crearCliente('5511110001', 40);
      await crearCliente('5511110002', 60);

      const base = await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();
      expect(base.clientesBaseRegistrados).toBe(2);
      expect(await filasEstado(regla.id)).toBe(2);
      expect((await s.h.prisma.regla.findUniqueOrThrow({ where: { id: regla.id } })).estadoBasePendiente).toBe(false);

      await crearCliente('5511110003', 45);
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
      expect(enviar.mock.calls[0][1].telefono).toBe('5511110003');
    });

    it('una regla nueva (sin la marca) envía en su primer barrido a todos los que cumplen', async () => {
      await crearRegla();
      await crearCliente('5511110001', 40);
      await crearCliente('5511110002', 60);
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(2);
    });
  });

  describe('candado de Marketing', () => {
    const logPrevio = (clienteId: string, reglaId: string, estado: 'EXITO' | 'FALLO', hace = 0) =>
      s.h.prisma.reglaEnvioLog.create({
        data: {
          tenantId: s.base.tenant.id,
          clienteId,
          reglaId,
          categoria: 'MARKETING',
          estado,
          createdAt: new Date(Date.now() - hace * DIA_MS),
        },
      });

    it('un FALLO reciente no consume el cupo del cliente', async () => {
      const otra = await crearRegla({ nombre: 'Otra', plantillaCategoria: 'MARKETING', filtro: [{ campo: 'TOTAL_PEDIDOS', operador: 'MAYOR_IGUAL', valor: 99 }] });
      await crearRegla({ nombre: 'Promo', plantillaCategoria: 'MARKETING' });
      const cliente = await crearCliente('5511110001', 40);
      await logPrevio(cliente.id, otra.id, 'FALLO', 1);

      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('un envío exitoso reciente sí bloquea; no se registra y se envía cuando el candado se libera', async () => {
      const otra = await crearRegla({ nombre: 'Otra', plantillaCategoria: 'MARKETING', filtro: [{ campo: 'TOTAL_PEDIDOS', operador: 'MAYOR_IGUAL', valor: 99 }] });
      const promo = await crearRegla({ nombre: 'Promo', plantillaCategoria: 'MARKETING' });
      const cliente = await crearCliente('5511110001', 40);
      await logPrevio(cliente.id, otra.id, 'EXITO', 1);

      const bloqueado = await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();
      expect(bloqueado.enviosBloqueadosPorCandado).toBe(1);
      expect(await filasEstado(promo.id)).toBe(0);

      jest.setSystemTime(new Date(Date.now() + 8 * DIA_MS));
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
      expect(await filasEstado(promo.id)).toBe(1);
    });
  });

  describe('cambio de trigger (API)', () => {
    it('una regla ESTADO_CLIENTE que cambia a otro trigger pierde su registro de quién cumple, y la API no expone el campo interno', async () => {
      const regla = await crearRegla();
      await crearCliente('5511110001', 40);
      await barrido.ejecutarBarrido();
      expect(await filasEstado(regla.id)).toBe(1);

      const res = await apiRol(s.h, s.base, 'DUENO').patch(`/reglas/${regla.id}`).send({ trigger: 'MANUAL' });
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('estadoBasePendiente');
      expect(await filasEstado(regla.id)).toBe(0);
    });
  });
});
