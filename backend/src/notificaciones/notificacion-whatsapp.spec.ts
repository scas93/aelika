import { BadRequestException } from '@nestjs/common';
import { telefonoParaEnvio } from '../common/telefono-internacional';
import { normalizarTelefonoDestinatario, validarConfigWhatsapp } from './notificacion-whatsapp';

const ID = '11111111-1111-4111-8111-111111111111';
const d = (nombre: string, telefono: string, id?: string) => ({ ...(id ? { id } : {}), nombre, telefono });

describe('normalizarTelefonoDestinatario', () => {
  it.each([
    ['5512345678', '5512345678'],
    ['55 1234 5678', '5512345678'],
    ['(55) 1234-5678', '5512345678'],
    ['+52 55 1234 5678', '5512345678'],
    ['+521 55 1234 5678', '5512345678'],
    ['+18188140000', '+18188140000'],
    ['+1 (818) 814-0000', '+18188140000'],
    ['+34 612 345 678', '+34612345678'],
  ])('%s → %s', (crudo, esperado) => {
    expect(normalizarTelefonoDestinatario(crudo)).toBe(esperado);
  });

  it.each(['', '   ', '123', '551234567', '55123456789', '525512345678', '18188140000', '0052 55 1234 5678', 'abc', '55-1234-567a', '+123', '+1234567890123456', '+1111111111', null, 12345678])(
    'rechaza %p',
    (crudo) => {
      expect(() => normalizarTelefonoDestinatario(crudo)).toThrow(BadRequestException);
    },
  );

  it('lo guardado se manda bien: 10 dígitos llevan +52 y los internacionales van completos', () => {
    expect(telefonoParaEnvio(normalizarTelefonoDestinatario('55 1234 5678'))).toBe('+525512345678');
    expect(telefonoParaEnvio(normalizarTelefonoDestinatario('+52 55 1234 5678'))).toBe('+525512345678');
    expect(telefonoParaEnvio(normalizarTelefonoDestinatario('+1 818 814 0000'))).toBe('+18188140000');
  });
});

describe('validarConfigWhatsapp', () => {
  it('forma canónica: conserva ids válidas, genera las que faltan, recorta nombres y descarta llaves ajenas', () => {
    const r = validarConfigWhatsapp({ otra: 1, destinatarios: [d('  Ana  ', '55 1234 5678', ID), d('Luis', '+18188140000')] });
    expect(Object.keys(r)).toStrictEqual(['destinatarios']);
    expect(r.destinatarios[0]).toStrictEqual({ id: ID, nombre: 'Ana', telefono: '5512345678' });
    expect(r.destinatarios[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.destinatarios[1]).toMatchObject({ nombre: 'Luis', telefono: '+18188140000' });
  });

  it('una id repetida o inválida se reemplaza; las ids quedan únicas', () => {
    const r = validarConfigWhatsapp({ destinatarios: [d('A', '5511111112', ID), d('B', '5511111113', ID), d('C', '5511111114', 'no-uuid')] });
    expect(new Set(r.destinatarios.map((x) => x.id)).size).toBe(3);
  });

  it('acepta 0 destinatarios (la regla de "activo exige 1" es del servicio) y exactamente 10; 11 se rechaza', () => {
    expect(validarConfigWhatsapp({ destinatarios: [] }).destinatarios).toStrictEqual([]);
    const diez = Array.from({ length: 10 }, (_, i) => d(`P${i}`, `551234567${i}`));
    expect(validarConfigWhatsapp({ destinatarios: diez }).destinatarios).toHaveLength(10);
    expect(() => validarConfigWhatsapp({ destinatarios: [...diez, d('Extra', '5599999999')] })).toThrow('Máximo 10 destinatarios');
  });

  it('teléfonos repetidos se detectan ya normalizados', () => {
    expect(() => validarConfigWhatsapp({ destinatarios: [d('A', '55 1234 5678'), d('B', '+52 5512345678')] })).toThrow('repetido');
  });

  it('nombre obligatorio y de máximo 60 caracteres; sin lista → 400', () => {
    expect(() => validarConfigWhatsapp({ destinatarios: [d('   ', '5512345678')] })).toThrow('necesita un nombre');
    expect(validarConfigWhatsapp({ destinatarios: [d('x'.repeat(60), '5512345678')] }).destinatarios).toHaveLength(1);
    expect(() => validarConfigWhatsapp({ destinatarios: [d('x'.repeat(61), '5512345678')] })).toThrow('60');
    for (const malo of [null, {}, { destinatarios: 'x' }, { destinatarios: {} }]) {
      expect(() => validarConfigWhatsapp(malo)).toThrow(BadRequestException);
    }
  });
});
