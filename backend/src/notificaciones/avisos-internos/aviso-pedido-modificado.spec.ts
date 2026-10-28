import { construirPayloadAviso, fechaSemanaEnEspanol, ultimos4 } from './aviso-pedido-modificado';

describe('fechaSemanaEnEspanol (componentes UTC, mes en minúsculas, sin año)', () => {
  it.each([
    ['2026-10-26', '26 de octubre'],
    ['2026-11-30', '30 de noviembre'],
    ['2026-12-28', '28 de diciembre'],
    ['2027-01-04', '4 de enero'],
    ['2027-03-01', '1 de marzo'],
    ['2026-09-28', '28 de septiembre'],
    ['2028-02-28', '28 de febrero'],
  ])('%s → %s', (iso, esperado) => {
    expect(fechaSemanaEnEspanol(new Date(`${iso}T00:00:00.000Z`))).toBe(esperado);
  });

  it('no depende de la zona horaria del servidor: la medianoche UTC sigue siendo ese día', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Mexico_City';
    try {
      expect(fechaSemanaEnEspanol(new Date('2026-11-01T00:00:00.000Z'))).toBe('1 de noviembre');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('ultimos4', () => {
  it('toma los últimos 4 dígitos de un teléfono guardado', () => {
    expect(ultimos4('5512345678')).toBe('5678');
    expect(ultimos4('+18188140000')).toBe('0000');
  });
});

describe('construirPayloadAviso', () => {
  const base = {
    correlacionId: 'c1',
    negocioSlug: 'panaderia-banetto',
    telefonoGuardado: '3331006915',
    negocioNombre: '  Cafetería\nLuna  ',
    semanaInicio: new Date('2026-10-26T00:00:00.000Z'),
    orderId: 'abc',
  };

  it('arma el contrato: tipo AVISO_INTERNO, plantilla fija, variables saneadas y botón sin sanear', () => {
    expect(construirPayloadAviso(base)).toStrictEqual({
      tipo: 'AVISO_INTERNO',
      correlacionId: 'c1',
      negocio: 'panaderia-banetto',
      telefono: '+523331006915',
      categoria: 'UTILITY',
      plantilla: { nombre: 'pedido_modificado_cliente', idioma: 'es_MX' },
      variables: ['Cafetería Luna', '26 de octubre'],
      boton: { tipo: 'URL_DINAMICA', indice: 0, valor: 'dashboard/pedidos-b2b?pedido=abc' },
    });
  });

  it('un nombre vacío cae a «—» y el botón no empieza con "/"', () => {
    const p = construirPayloadAviso({ ...base, negocioNombre: '   ' });
    expect(p.variables[0]).toBe('—');
    expect(p.boton.valor.startsWith('/')).toBe(false);
  });
});
