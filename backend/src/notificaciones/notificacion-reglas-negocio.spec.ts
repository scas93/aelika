import { exigirEventoPermitido } from './notificacion-reglas-negocio';

describe('exigirEventoPermitido · ENTREGA_CONFIRMADA', () => {
  it('mayoreo + CLIENTE + CORREO es válido', () => {
    expect(() => exigirEventoPermitido('RETAIL_B2B', 'ENTREGA_CONFIRMADA', 'CLIENTE', 'CORREO')).not.toThrow();
  });
  it('la audiencia NEGOCIO y el canal WHATSAPP se rechazan', () => {
    expect(() => exigirEventoPermitido('RETAIL_B2B', 'ENTREGA_CONFIRMADA', 'NEGOCIO', 'CORREO')).toThrow(/solo avisa al cliente/);
    expect(() => exigirEventoPermitido('RETAIL_B2B', 'ENTREGA_CONFIRMADA', 'CLIENTE', 'WHATSAPP')).toThrow(/Correo/);
  });
  it('fuera de mayoreo es 403', () => {
    expect(() => exigirEventoPermitido('RETAIL_B2C', 'ENTREGA_CONFIRMADA', 'CLIENTE', 'CORREO')).toThrow(/mayoreo/);
  });
});
