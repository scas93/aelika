import { CorreoProvider } from './correo.provider';

const send = jest.fn();
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send } })) }));

const config = (valores: Record<string, string | undefined>) => ({
  get: (k: string, def?: string) => valores[k] ?? def,
});
const proveedor = (valores: Record<string, string | undefined> = { RESEND_API_KEY: 're_test', RESEND_FROM_ADDRESS: 'notificaciones@aelika.com' }) =>
  new CorreoProvider(config(valores) as any);

describe('CorreoProvider', () => {
  beforeEach(() => send.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null }));

  describe('enviar (correo B2C): sin cambios', () => {
    it('un destinatario como texto y SIN adjuntos', async () => {
      const r = await proveedor().enviar('cli@example.com', { asunto: 'A', texto: 'T', html: '<p>H</p>' }, { nombreRemitente: 'Tienda' });
      expect(r).toEqual({ exito: true });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toStrictEqual({
        from: 'Tienda <notificaciones@aelika.com>',
        to: 'cli@example.com',
        subject: 'A',
        text: 'T',
        html: '<p>H</p>',
      });
    });
  });

  describe('enviarConAdjuntos (resumen semanal)', () => {
    const base = {
      destinatarios: ['a@example.com', 'b@example.com'],
      nombreRemitente: 'Banetto',
      mensaje: { asunto: 'Resumen · Panadería Ñ', texto: 'T', html: '<p>H</p>' },
      adjuntos: [{ nombreArchivo: 'Pedidos Ñandú.xlsx', contenido: Buffer.from('xlsx') }],
    };

    it('varios destinatarios, remitente sobre la dirección de Aelika y adjunto con su nombre', async () => {
      expect(await proveedor().enviarConAdjuntos(base)).toEqual({ exito: true });
      expect(send.mock.calls[0][0]).toStrictEqual({
        from: 'Banetto <notificaciones@aelika.com>',
        to: ['a@example.com', 'b@example.com'],
        subject: 'Resumen · Panadería Ñ',
        text: 'T',
        html: '<p>H</p>',
        attachments: [{ filename: 'Pedidos Ñandú.xlsx', content: base.adjuntos[0].contenido }],
      });
    });

    it('sin adjuntos manda attachments indefinido', async () => {
      await proveedor().enviarConAdjuntos({ ...base, adjuntos: undefined });
      expect(send.mock.calls[0][0].attachments).toBeUndefined();
    });

    it('sin RESEND_API_KEY, sin direcciones o sin remitente: falla con motivo y no llama a Resend', async () => {
      expect(await proveedor({}).enviarConAdjuntos(base)).toEqual({ exito: false, error: 'RESEND_API_KEY no está configurado en este ambiente' });
      expect((await proveedor().enviarConAdjuntos({ ...base, destinatarios: [] })).exito).toBe(false);
      expect((await proveedor().enviarConAdjuntos({ ...base, nombreRemitente: '' })).exito).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('si Resend rechaza o lanza, devuelve exito:false (nunca lanza)', async () => {
      send.mockResolvedValueOnce({ data: null, error: { message: 'dominio no verificado' } });
      expect(await proveedor().enviarConAdjuntos(base)).toEqual({ exito: false, error: 'Resend: dominio no verificado' });
      send.mockRejectedValueOnce(new Error('timeout'));
      expect(await proveedor().enviarConAdjuntos(base)).toEqual({ exito: false, error: 'Resend: error inesperado — timeout' });
    });
  });
});
