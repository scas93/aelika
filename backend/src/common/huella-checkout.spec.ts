import { calcularHuellaCheckout, carritoCanonico, EntradaHuella, normalizarNombre } from './huella-checkout';

const base = (): EntradaHuella => ({
  tenantId: 't1',
  clienteTelefono: '+52 55 1111 2222',
  clienteNombre: 'Ana',
  clienteCorreo: undefined,
  items: [
    { productId: 'b', cantidad: 1 },
    { productId: 'a', cantidad: 2, modifierOptionIds: ['m2', 'm1'] },
  ],
  metodoEntrega: 'RECOGER',
  puntoEnvioId: null,
  direccion: { direccionCalle: null, direccionNumero: null, direccionColonia: null, direccionReferencias: null },
  notas: undefined,
  factura: {
    requiereFactura: false,
    facturaRazonSocial: null,
    facturaRfc: null,
    facturaRegimenFiscal: null,
    facturaUsoCfdi: null,
    facturaCodigoPostal: null,
    facturaCorreo: null,
  },
  total: 45,
});

describe('calcularHuellaCheckout', () => {
  it('es un SHA-256 hexadecimal y determinista', () => {
    const h = calcularHuellaCheckout(base());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(calcularHuellaCheckout(base())).toBe(h);
  });

  it('no depende del orden de las líneas ni de los modificadores', () => {
    const e = base();
    e.items = [
      { productId: 'a', cantidad: 2, modifierOptionIds: ['m1', 'm2'] },
      { productId: 'b', cantidad: 1 },
    ];
    expect(calcularHuellaCheckout(e)).toBe(calcularHuellaCheckout(base()));
  });

  it('fusiona líneas idénticas sumando cantidad', () => {
    expect(carritoCanonico([{ productId: 'a', cantidad: 1 }, { productId: 'a', cantidad: 1 }])).toStrictEqual(carritoCanonico([{ productId: 'a', cantidad: 2 }]));
    expect(carritoCanonico([{ productId: 'a', cantidad: 1, modifierOptionIds: ['x'] }, { productId: 'a', cantidad: 1 }])).toHaveLength(2);
  });

  it('undefined, null y "" equivalen; se recorta; el teléfono se normaliza; el total usa 2 decimales', () => {
    const e = base();
    e.clienteCorreo = '  ';
    e.notas = '';
    e.clienteNombre = '  Ana ';
    e.clienteTelefono = '5511112222';
    e.total = 45.0;
    expect(calcularHuellaCheckout(e)).toBe(calcularHuellaCheckout(base()));
  });

  it.each<[string, (e: EntradaHuella) => void]>([
    ['tenant', (e) => (e.tenantId = 't2')],
    ['teléfono', (e) => (e.clienteTelefono = '5500000000')],
    ['nombre', (e) => (e.clienteNombre = 'Beto')],
    ['correo', (e) => (e.clienteCorreo = 'a@b.com')],
    ['cantidad', (e) => (e.items[0].cantidad = 3)],
    ['modificador', (e) => (e.items[1].modifierOptionIds = ['m1'])],
    ['entrega', (e) => (e.metodoEntrega = 'DOMICILIO')],
    ['punto de envío', (e) => (e.puntoEnvioId = 'p1')],
    ['calle', (e) => (e.direccion.direccionCalle = 'Reforma')],
    ['notas', (e) => (e.notas = 'sin cebolla')],
    ['factura', (e) => (e.factura.requiereFactura = true)],
    ['RFC', (e) => (e.factura.facturaRfc = 'XAXX010101000')],
    ['total', (e) => (e.total = 45.01)],
  ])('cambia si cambia: %s', (_campo, mutar) => {
    const e = base();
    mutar(e);
    expect(calcularHuellaCheckout(e)).not.toBe(calcularHuellaCheckout(base()));
  });
});

describe('normalizarNombre', () => {
  it('quita acentos, pasa a minúsculas y colapsa espacios', () => {
    expect(normalizarNombre('  ÁNA   Pérez ')).toBe('ana perez');
    expect(normalizarNombre(null)).toBe('');
  });
});
