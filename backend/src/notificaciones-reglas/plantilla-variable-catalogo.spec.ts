import { Cliente, Tenant } from '../../generated/prisma/client';
import { ReglaPlantillaVariableFuente, ReglaTriggerOrigenPedido, ReglaTriggerTipo } from '../../generated/prisma/enums';
import {
  buscarEnCatalogo,
  CATALOGO_VARIABLES,
  disponibleParaContexto,
  disponibleParaTrigger,
  ResolverContexto,
} from './plantilla-variable-catalogo';
import { PedidoContexto, PedidoContextoOrder, PedidoContextoPedidoB2b } from './plantilla-variable.type';

const AHORA = new Date('2026-09-24T12:00:00.000Z');

const tenant = {
  nombre: 'Masa Madre',
  slug: 'masa-madre',
  ubicacion: 'Chapultepec 45',
} as Tenant;

const cliente = {
  nombre: 'Ana López',
  totalPedidos: 7,
  ultimoPedidoAt: new Date('2026-09-06T12:00:00.000Z'), // 18 días antes de AHORA
  primerPedidoAt: new Date('2026-03-15T12:00:00.000Z'),
} as Cliente;

const itemsPedido = [
  { nombreProducto: 'Concha', cantidad: 2 },
  { nombreProducto: 'Café americano', cantidad: 1 },
];

const contextoOrderRecoger: PedidoContextoOrder = {
  origen: 'ORDER',
  folio: 'A-1043',
  total: 1245.5,
  estatus: 'LISTO_ENTREGA',
  createdAt: new Date('2026-09-24T18:30:00.000Z'),
  items: itemsPedido,
  metodoEntrega: 'RECOGER',
  direccionCalle: null,
  direccionNumero: null,
  direccionColonia: null,
  metodoPago: 'EFECTIVO',
};

const contextoOrderDomicilio: PedidoContextoOrder = {
  ...contextoOrderRecoger,
  metodoEntrega: 'DOMICILIO',
  direccionCalle: 'Av. Patria',
  direccionNumero: '123',
  direccionColonia: 'Jardines',
};

const contextoB2b: PedidoContextoPedidoB2b = {
  origen: 'PEDIDO_B2B',
  folio: 'B-88',
  total: 5000,
  estatus: 'CONFIRMADO_SURTIENDO',
  createdAt: new Date('2026-09-24T18:30:00.000Z'),
  items: itemsPedido,
};

function resolver(fuente: ReglaPlantillaVariableFuente, valor: string, contexto: PedidoContexto | undefined, storefrontUrl = 'http://localhost:3000/tienda/masa-madre'): string | null {
  const def = buscarEnCatalogo(fuente, valor);
  if (!def) throw new Error(`No está en el catálogo: ${fuente}/${valor}`);
  const ctx: ResolverContexto = { tenant, cliente, contexto, ahora: AHORA, storefrontUrl };
  return def.resolver(ctx);
}

const F = ReglaPlantillaVariableFuente;

describe('CATALOGO_VARIABLES — retrocompatibilidad', () => {
  it('las 4 combinaciones que ya existían antes de este catálogo siguen presentes', () => {
    expect(buscarEnCatalogo(F.CAMPO_CLIENTE, 'nombre')).toBeDefined();
    expect(buscarEnCatalogo(F.CAMPO_PEDIDO, 'folio')).toBeDefined();
    expect(buscarEnCatalogo(F.NOMBRE_NEGOCIO, 'nombre')).toBeDefined();
    // VALOR_FIJO no tiene entrada en el catálogo — se maneja aparte (texto libre).
  });
});

describe('CATALOGO_VARIABLES — resolución de cada variable', () => {
  it('Cliente: nombre / primer nombre / número de pedidos / cliente desde', () => {
    expect(resolver(F.CAMPO_CLIENTE, 'nombre', undefined)).toBe('Ana López');
    expect(resolver(F.CAMPO_CLIENTE, 'primerNombre', undefined)).toBe('Ana');
    expect(resolver(F.CAMPO_CLIENTE, 'totalPedidos', undefined)).toBe('7');
    expect(resolver(F.CAMPO_CLIENTE, 'ultimaCompra', undefined)).toBe('6 de septiembre');
    expect(resolver(F.CAMPO_CLIENTE, 'diasDesdeUltimaCompra', undefined)).toBe('18');
    expect(resolver(F.CAMPO_CLIENTE, 'clienteDesde', undefined)).toBe('marzo de 2026');
  });

  it('Pedido (Order): folio / total / estatus / fecha / resumen', () => {
    expect(resolver(F.CAMPO_PEDIDO, 'folio', contextoOrderRecoger)).toBe('A-1043');
    expect(resolver(F.CAMPO_PEDIDO, 'total', contextoOrderRecoger)).toBe('$1,245.50');
    expect(resolver(F.CAMPO_PEDIDO, 'estatus', contextoOrderRecoger)).toBe('Listo para entrega');
    expect(resolver(F.CAMPO_PEDIDO, 'fechaHora', contextoOrderRecoger)).toBe('24 sep, 12:30');
    expect(resolver(F.CAMPO_PEDIDO, 'resumenProductos', contextoOrderRecoger)).toBe('2x Concha, 1x Café americano');
  });

  it('Pedido (PedidoB2b): estatus usa el label de PedidoB2bEstado, no el de EstadoPedido', () => {
    expect(resolver(F.CAMPO_PEDIDO, 'estatus', contextoB2b)).toBe('Confirmado y surtiendo');
    expect(resolver(F.CAMPO_PEDIDO, 'folio', contextoB2b)).toBe('B-88');
  });

  it('Pedido, solo menudeo: tipo de entrega / dirección / método de pago', () => {
    expect(resolver(F.CAMPO_PEDIDO, 'tipoEntrega', contextoOrderRecoger)).toBe('Recoger en tienda');
    expect(resolver(F.CAMPO_PEDIDO, 'tipoEntrega', contextoOrderDomicilio)).toBe('Envío a domicilio');
    expect(resolver(F.CAMPO_PEDIDO, 'direccionEntrega', contextoOrderRecoger)).toBe('Recoger en tienda');
    expect(resolver(F.CAMPO_PEDIDO, 'direccionEntrega', contextoOrderDomicilio)).toBe('Av. Patria 123, Jardines');
    expect(resolver(F.CAMPO_PEDIDO, 'metodoPago', contextoOrderRecoger)).toBe('Efectivo');
  });

  it('Pedido, solo menudeo: no resuelve nada para PedidoB2b (null, no un texto genérico)', () => {
    expect(resolver(F.CAMPO_PEDIDO, 'tipoEntrega', contextoB2b)).toBeNull();
    expect(resolver(F.CAMPO_PEDIDO, 'direccionEntrega', contextoB2b)).toBeNull();
    expect(resolver(F.CAMPO_PEDIDO, 'metodoPago', contextoB2b)).toBeNull();
  });

  it('Pedido: campos CAMPO_PEDIDO sin contexto regresan null (el fallback lo aplica quien llama)', () => {
    expect(resolver(F.CAMPO_PEDIDO, 'folio', undefined)).toBeNull();
    expect(resolver(F.CAMPO_PEDIDO, 'total', undefined)).toBeNull();
  });

  it('Negocio: nombre / link / ubicación', () => {
    expect(resolver(F.NOMBRE_NEGOCIO, 'nombre', undefined)).toBe('Masa Madre');
    expect(resolver(F.NOMBRE_NEGOCIO, 'link', undefined, 'http://localhost:3000/tienda/masa-madre')).toBe(
      'http://localhost:3000/tienda/masa-madre',
    );
    expect(resolver(F.NOMBRE_NEGOCIO, 'ubicacion', undefined)).toBe('Chapultepec 45');
  });

  it('Negocio: ubicación null cuando el tenant no la tiene configurada (el fallback lo aplica quien llama)', () => {
    const sinUbicacion = { ...tenant, ubicacion: null } as Tenant;
    const def = buscarEnCatalogo(F.NOMBRE_NEGOCIO, 'ubicacion')!;
    expect(def.resolver({ tenant: sinUbicacion, cliente, contexto: undefined, ahora: AHORA, storefrontUrl: '' })).toBeNull();
  });
});

describe('disponibleParaTrigger — validación al guardar', () => {
  const folioDef = buscarEnCatalogo(F.CAMPO_PEDIDO, 'folio')!;
  const tipoEntregaDef = buscarEnCatalogo(F.CAMPO_PEDIDO, 'tipoEntrega')!;
  const nombreClienteDef = buscarEnCatalogo(F.CAMPO_CLIENTE, 'nombre')!;

  it('sin restricción: disponible en cualquier trigger', () => {
    expect(disponibleParaTrigger(nombreClienteDef.restriccion, ReglaTriggerTipo.ESTADO_CLIENTE, undefined)).toBe(true);
    expect(disponibleParaTrigger(nombreClienteDef.restriccion, ReglaTriggerTipo.EVENTO_PEDIDO, ReglaTriggerOrigenPedido.ORDER)).toBe(
      true,
    );
  });

  it('evento_pedido: solo si el trigger es EVENTO_PEDIDO, sin importar el origen', () => {
    expect(disponibleParaTrigger(folioDef.restriccion, ReglaTriggerTipo.ESTADO_CLIENTE, undefined)).toBe(false);
    expect(disponibleParaTrigger(folioDef.restriccion, ReglaTriggerTipo.MANUAL, undefined)).toBe(false);
    expect(disponibleParaTrigger(folioDef.restriccion, ReglaTriggerTipo.EVENTO_PEDIDO, ReglaTriggerOrigenPedido.ORDER)).toBe(true);
    expect(disponibleParaTrigger(folioDef.restriccion, ReglaTriggerTipo.EVENTO_PEDIDO, ReglaTriggerOrigenPedido.PEDIDO_B2B)).toBe(
      true,
    );
  });

  it('evento_pedido_menudeo: solo EVENTO_PEDIDO + origen ORDER', () => {
    expect(disponibleParaTrigger(tipoEntregaDef.restriccion, ReglaTriggerTipo.EVENTO_PEDIDO, ReglaTriggerOrigenPedido.ORDER)).toBe(
      true,
    );
    expect(
      disponibleParaTrigger(tipoEntregaDef.restriccion, ReglaTriggerTipo.EVENTO_PEDIDO, ReglaTriggerOrigenPedido.PEDIDO_B2B),
    ).toBe(false);
    expect(disponibleParaTrigger(tipoEntregaDef.restriccion, ReglaTriggerTipo.ESTADO_CLIENTE, undefined)).toBe(false);
  });
});

describe('disponibleParaContexto — resolución al enviar', () => {
  const folioDef = buscarEnCatalogo(F.CAMPO_PEDIDO, 'folio')!;
  const tipoEntregaDef = buscarEnCatalogo(F.CAMPO_PEDIDO, 'tipoEntrega')!;
  const nombreClienteDef = buscarEnCatalogo(F.CAMPO_CLIENTE, 'nombre')!;

  it('sin restricción: disponible con o sin contexto', () => {
    expect(disponibleParaContexto(nombreClienteDef.restriccion, undefined)).toBe(true);
    expect(disponibleParaContexto(nombreClienteDef.restriccion, contextoOrderRecoger)).toBe(true);
  });

  it('evento_pedido: requiere contexto, de cualquier origen', () => {
    expect(disponibleParaContexto(folioDef.restriccion, undefined)).toBe(false);
    expect(disponibleParaContexto(folioDef.restriccion, contextoOrderRecoger)).toBe(true);
    expect(disponibleParaContexto(folioDef.restriccion, contextoB2b)).toBe(true);
  });

  it('evento_pedido_menudeo: requiere contexto con origen ORDER', () => {
    expect(disponibleParaContexto(tipoEntregaDef.restriccion, contextoOrderRecoger)).toBe(true);
    expect(disponibleParaContexto(tipoEntregaDef.restriccion, contextoB2b)).toBe(false);
    expect(disponibleParaContexto(tipoEntregaDef.restriccion, undefined)).toBe(false);
  });
});

describe('CATALOGO_VARIABLES — cada entrada tiene fallback no vacío', () => {
  const casos: Array<[string, (typeof CATALOGO_VARIABLES)[number]]> = CATALOGO_VARIABLES.map((def) => [
    `${def.fuente}/${def.valor}`,
    def,
  ]);

  it.each(casos)('%s', (_nombre, def) => {
    expect(def.fallback.trim().length).toBeGreaterThan(0);
  });
});
