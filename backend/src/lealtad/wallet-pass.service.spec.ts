import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatosPaseInput, WalletPassService } from './wallet-pass.service';

const SERIAL = '9e326ed3-c2c3-4fec-86d7-bdac9f53527a';

function servicio(env: Record<string, string> = {}) {
  const config = {
    get: (k: string) => ({ WALLETWALLET_API_KEY: 'ww_live_test', ...env })[k],
  } as unknown as ConfigService;
  return new WalletPassService(config);
}

function input(serialNumber: string | null = SERIAL): DatosPaseInput {
  return {
    loyaltyCard: {
      id: 'card-1',
      tenantId: 't-1',
      clienteId: 'c-1',
      token: 'tok',
      contador: 2,
      serialNumber,
    } as never,
    clienteNombre: 'Ana',
    tenantNombre: 'Pizzería Demo',
    yaCanjeoPremio: false,
  };
}

const respuesta = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('WalletPassService — link de una tarjeta existente', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('urlCompartir', () => {
    it('usa <base>/p/<serial> con la base por defecto', () => {
      expect(servicio().urlCompartir(SERIAL)).toBe(
        `https://pass.walletwallet.dev/p/${SERIAL}`,
      );
    });

    it('respeta WALLETWALLET_SHARE_BASE_URL y le quita la diagonal final', () => {
      const s = servicio({
        WALLETWALLET_SHARE_BASE_URL: 'https://pase.ejemplo.test//',
      });
      expect(s.urlCompartir(SERIAL)).toBe(
        `https://pase.ejemplo.test/p/${SERIAL}`,
      );
    });

    it('una variable en blanco cae al valor por defecto', () => {
      expect(
        servicio({ WALLETWALLET_SHARE_BASE_URL: '  ' }).urlCompartir(SERIAL),
      ).toBe(`https://pass.walletwallet.dev/p/${SERIAL}`);
    });
  });

  describe('refrescarYObtenerLink', () => {
    it('PUT ok (sin shareUrl en la respuesta): entrega el link derivado del serial, sin crear otro pase', async () => {
      fetchMock.mockResolvedValue(
        respuesta(200, {
          serialNumber: SERIAL,
          lastUpdated: 1,
          notifiedDevices: 0,
          unchanged: true,
        }),
      );

      await expect(servicio().refrescarYObtenerLink(input())).resolves.toEqual({
        serialNumber: SERIAL,
        shareUrl: `https://pass.walletwallet.dev/p/${SERIAL}`,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.walletwallet.dev/api/passes/${SERIAL}`);
      expect(opts.method).toBe('PUT');
    });

    it.each([400, 401, 429, 500, 503])(
      'PUT %i: entrega el link igual y deja el fallo en logs',
      async (status) => {
        fetchMock.mockResolvedValue(respuesta(status, { error: 'x' }));
        const warn = jest.spyOn(Logger.prototype, 'warn');

        await expect(
          servicio().refrescarYObtenerLink(input()),
        ).resolves.toEqual({
          serialNumber: SERIAL,
          shareUrl: `https://pass.walletwallet.dev/p/${SERIAL}`,
        });
        expect(jest.spyOn(Logger.prototype, 'error')).toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`HTTP ${status}`),
        );
      },
    );

    it('PUT que lanza (timeout/red): entrega el link igual y lo registra', async () => {
      fetchMock.mockRejectedValue(
        new DOMException('timed out', 'TimeoutError'),
      );

      await expect(
        servicio().refrescarYObtenerLink(input()),
      ).resolves.toMatchObject({
        shareUrl: `https://pass.walletwallet.dev/p/${SERIAL}`,
      });
      expect(jest.spyOn(Logger.prototype, 'error')).toHaveBeenCalledWith(
        expect.stringContaining('timed out'),
      );
    });

    it('PUT 404 (serial desconocido): NO entrega el link derivado', async () => {
      fetchMock.mockResolvedValue(respuesta(404, { error: 'not found' }));

      await expect(
        servicio().refrescarYObtenerLink(input()),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('sin serialNumber no hay link que entregar', async () => {
      await expect(
        servicio().refrescarYObtenerLink(input(null)),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('actualizarPase (sello/redención) — sin cambios de contrato', () => {
    it('devuelve null si el PUT falla', async () => {
      fetchMock.mockResolvedValue(respuesta(500));
      await expect(servicio().actualizarPase(input())).resolves.toBeNull();
    });

    it('devuelve lo que responde el PUT si sale bien', async () => {
      fetchMock.mockResolvedValue(
        respuesta(200, { serialNumber: SERIAL, unchanged: false }),
      );
      await expect(servicio().actualizarPase(input())).resolves.toEqual({
        serialNumber: SERIAL,
        unchanged: false,
      });
    });
  });
});
