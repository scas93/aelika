import { BadRequestException } from '@nestjs/common';
import { BOTON_URL_FOLIO_RESERVA, resolverBotonUrlValor } from './boton-url';
import { validarBotonUrlValor } from './reglas.service';
import type { PedidoContexto } from './plantilla-variable.type';

const reserva = (folio: string): PedidoContexto => ({
  origen: 'RESERVA',
  folio,
  total: '0',
  estatus: '',
  createdAt: new Date(),
  items: [],
  checkIn: new Date('2026-10-11T00:00:00.000Z'),
  checkOut: new Date('2026-10-12T00:00:00.000Z'),
  adultos: 1,
  ninos: 0,
  habitaciones: null,
  enlaceCheckin: null,
});

describe('resolverBotonUrlValor', () => {
  it('un valor fijo se devuelve tal cual, con o sin contexto (modo de siempre)', () => {
    expect(resolverBotonUrlValor('panaderia-banetto', undefined)).toBe('panaderia-banetto');
    expect(resolverBotonUrlValor('panaderia-banetto', reserva('123'))).toBe('panaderia-banetto');
  });

  it('el marcador usa el folio de CADA reserva', () => {
    expect(resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, reserva('9641816459'))).toBe('9641816459');
    expect(resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, reserva('819461410'))).toBe('819461410');
  });

  it('codifica para URL los caracteres especiales del folio', () => {
    expect(resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, reserva('AB 12/3?x=1&y#z'))).toBe('AB%2012%2F3%3Fx%3D1%26y%23z');
    expect(resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, reserva(' 55 '))).toBe('55');
  });

  it('folio vacío, demasiado largo o sin reserva de contexto → BadRequest (sin botón roto)', () => {
    expect(() => resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, reserva('   '))).toThrow(BadRequestException);
    expect(() => resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, reserva('9'.repeat(201)))).toThrow(BadRequestException);
    expect(() => resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, reserva('/'.repeat(70)))).toThrow(BadRequestException); // 210 al codificar
    expect(() => resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, undefined)).toThrow(BadRequestException);
    expect(() => resolverBotonUrlValor(BOTON_URL_FOLIO_RESERVA, { origen: 'SEMANA', semanaInicio: new Date(), semanaFin: new Date() })).toThrow(BadRequestException);
  });
});

describe('validarBotonUrlValor · marcador del folio', () => {
  it('se acepta solo en RESERVA_AUTOMATICA', () => {
    expect(validarBotonUrlValor(' {numeroReserva} ', 'RESERVA_AUTOMATICA' as any)).toBe(BOTON_URL_FOLIO_RESERVA);
    expect(() => validarBotonUrlValor(BOTON_URL_FOLIO_RESERVA, 'RECORDATORIO_SEMANAL_PEDIDO' as any)).toThrow(BadRequestException);
    expect(() => validarBotonUrlValor(BOTON_URL_FOLIO_RESERVA)).toThrow(BadRequestException);
  });

  it('las validaciones del valor fijo no cambian', () => {
    expect(validarBotonUrlValor('panaderia-banetto', 'RESERVA_AUTOMATICA' as any)).toBe('panaderia-banetto');
    expect(validarBotonUrlValor('  ', 'RESERVA_AUTOMATICA' as any)).toBeNull();
    expect(validarBotonUrlValor(null)).toBeNull();
    for (const malo of ['https://x.com/a', '/a', 'a b', 'a'.repeat(201)]) {
      expect(() => validarBotonUrlValor(malo, 'RESERVA_AUTOMATICA' as any)).toThrow(BadRequestException);
    }
  });
});
