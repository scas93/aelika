import { ConfigService } from '@nestjs/config';
import { TelegramProvider } from './telegram.provider';
import { TELEGRAM_LIMITE } from './telegram-dividir';

describe('TelegramProvider.enviar', () => {
  const provider = new TelegramProvider({ get: () => 'token' } as unknown as ConfigService);
  const original = global.fetch;
  const fetchMock = jest.fn();
  const textos = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).text as string);

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = original;
  });

  it('un recibo corto se manda en UN mensaje, con el texto exacto y sin parse_mode', async () => {
    const texto = 'NUEVO PEDIDO #1 - X\nTOTAL: $10.00 MXN';
    expect(await provider.enviar('123', { texto })).toStrictEqual({ exito: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toStrictEqual({ chat_id: '123', text: texto });
  });

  it('un recibo más largo que el límite se manda completo en varios mensajes consecutivos y en orden', async () => {
    const lineas = Array.from({ length: 300 }, (_, i) => `1x Producto ${i} - $10.00\n   ↳ Nota ${i}`);
    const texto = ['NUEVO PEDIDO #9 - Entredós', ...lineas, 'TOTAL: $3000.00 MXN'].join('\n');
    expect(texto.length).toBeGreaterThan(TELEGRAM_LIMITE);
    expect(await provider.enviar('123', { texto })).toStrictEqual({ exito: true });
    const enviados = textos();
    expect(enviados.length).toBeGreaterThan(1);
    enviados.forEach((t, i) => {
      expect(t.length).toBeLessThanOrEqual(TELEGRAM_LIMITE);
      expect(t).toContain(`#9 - Entredós (parte ${i + 1}/${enviados.length})`);
    });
    expect(enviados[enviados.length - 1].trimEnd().endsWith('TOTAL: $3000.00 MXN')).toBe(true);
    for (let i = 0; i < 300; i++) expect(enviados.join('\n')).toContain(`↳ Nota ${i}`);
  });

  it('si una parte falla, corta el envío y reporta el fallo con la parte', async () => {
    const texto = ['NUEVO PEDIDO #9 - X', ...Array.from({ length: 400 }, (_, i) => `linea ${i} ${'z'.repeat(30)}`)].join('\n');
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) });
    const r = await provider.enviar('123', { texto });
    expect(r.exito).toBe(false);
    expect(r.error).toContain('Bad Request: chat not found');
    expect(r.error).toContain('(parte 2/');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
