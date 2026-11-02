import { BadGatewayException } from '@nestjs/common';
import { LealtadService } from './lealtad.service';
import { PublicLealtadService } from './public-lealtad.service';

const SERIAL = 'serial-existente';
const LINK = `https://pass.walletwallet.dev/p/${SERIAL}`;
const tenant = { id: 't-1', nombre: 'Pizzería Demo' };
const cliente = { id: 'c-1', nombre: 'Ana', telefono: '5550000301' };
const tarjeta = {
  id: 'card-1',
  tenantId: 't-1',
  clienteId: 'c-1',
  token: 'tok',
  contador: 0,
  serialNumber: SERIAL,
};

function walletMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    crearPase: jest.fn(),
    actualizarPase: jest.fn(),
    refrescarYObtenerLink: jest
      .fn()
      .mockResolvedValue({ serialNumber: SERIAL, shareUrl: LINK }),
    ...overrides,
  };
}

function dbMock(loyaltyCard: unknown) {
  return {
    loyaltyCard: {
      findUnique: jest.fn().mockResolvedValue(loyaltyCard),
      create: jest.fn(),
      update: jest.fn(),
    },
    loyaltyRedemption: { count: jest.fn().mockResolvedValue(0) },
    tenant: {
      findUnique: jest.fn().mockResolvedValue(tenant),
      findUniqueOrThrow: jest.fn().mockResolvedValue(tenant),
    },
    cliente: { findUniqueOrThrow: jest.fn().mockResolvedValue(cliente) },
  };
}

describe.each([
  [
    'LealtadService (panel)',
    (wallet: ReturnType<typeof walletMock>, db: ReturnType<typeof dbMock>) => {
      const clientes = {
        buscarOCrearParaLealtad: jest.fn().mockResolvedValue(cliente),
      };
      const svc = new LealtadService(
        { client: db } as never,
        clientes as never,
        wallet as never,
      );
      return () => svc.altaCliente('Ana', '5550000301');
    },
  ],
  [
    'PublicLealtadService (página pública)',
    (wallet: ReturnType<typeof walletMock>, db: ReturnType<typeof dbMock>) => {
      const clientes = {
        buscarOCrearParaLealtadPublico: jest.fn().mockResolvedValue(cliente),
      };
      const svc = new PublicLealtadService(
        db as never,
        clientes as never,
        wallet as never,
      );
      return () => svc.altaCliente('pizzeria-demo', 'Ana', '5550000301');
    },
  ],
])('%s — alta de un teléfono que ya tiene pase (rama 3)', (_nombre, armar) => {
  it('entrega el link de su misma tarjeta y no crea ni otra tarjeta ni otro pase', async () => {
    const wallet = walletMock();
    const db = dbMock(tarjeta);
    const respuesta = await armar(wallet, db)();

    expect(respuesta.pase).toEqual({ serialNumber: SERIAL, shareUrl: LINK });
    expect(respuesta.loyaltyCard).toBe(tarjeta);
    expect(wallet.refrescarYObtenerLink).toHaveBeenCalledTimes(1);
    expect(wallet.crearPase).not.toHaveBeenCalled();
    expect(db.loyaltyCard.create).not.toHaveBeenCalled();
    expect(db.loyaltyCard.update).not.toHaveBeenCalled();
  });

  it('manda a WalletWallet el nombre del cliente y el contador de la tarjeta', async () => {
    const wallet = walletMock();
    await armar(wallet, dbMock(tarjeta))();

    expect(wallet.refrescarYObtenerLink).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteNombre: 'Ana',
        tenantNombre: 'Pizzería Demo',
        loyaltyCard: tarjeta,
      }),
    );
  });

  it('si WalletWallet no conoce el serial (404) el error sube: no se entrega link', async () => {
    const wallet = walletMock({
      refrescarYObtenerLink: jest
        .fn()
        .mockRejectedValue(new BadGatewayException('pase no encontrado')),
    });

    await expect(armar(wallet, dbMock(tarjeta))()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});

describe('rama 2 (sin pase) — sin cambios', () => {
  it('sigue creando el pase y guardando el serial', async () => {
    const sinPase = { ...tarjeta, serialNumber: null };
    const wallet = walletMock({
      crearPase: jest
        .fn()
        .mockResolvedValue({
          serialNumber: 'nuevo',
          shareUrl: 'https://x/p/nuevo',
        }),
    });
    const db = dbMock(sinPase);
    db.loyaltyCard.update.mockResolvedValue({
      ...sinPase,
      serialNumber: 'nuevo',
    });
    const clientes = {
      buscarOCrearParaLealtad: jest.fn().mockResolvedValue(cliente),
    };

    const r = await new LealtadService(
      { client: db } as never,
      clientes as never,
      wallet as never,
    ).altaCliente('Ana', '5550000301');

    expect(wallet.crearPase).toHaveBeenCalledTimes(1);
    expect(wallet.refrescarYObtenerLink).not.toHaveBeenCalled();
    expect(r.pase).toMatchObject({ shareUrl: 'https://x/p/nuevo' });
  });
});
