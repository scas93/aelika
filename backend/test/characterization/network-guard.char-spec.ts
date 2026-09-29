import * as http from 'node:http';
import * as https from 'node:https';
import { bloqueados } from './network-guard';

describe('bloqueo de red saliente', () => {
  afterEach(() => {
    // El propio test consume los intentos que provoca a propósito.
    bloqueados.length = 0;
  });

  it('bloquea https (Stripe/Telegram/Resend) y lo registra', async () => {
    await new Promise<void>((resolve) => {
      const req = https.get('https://api.stripe.com/v1/charges', () => resolve());
      req.on('error', () => resolve());
    });
    expect(bloqueados.some((b) => b.startsWith('api.stripe.com'))).toBe(true);
  });

  it('bloquea fetch (Resend/Botpress)', async () => {
    await expect(fetch('https://api.resend.com/emails')).rejects.toBeDefined();
    expect(bloqueados.some((b) => b.startsWith('api.resend.com'))).toBe(true);
  });

  it('bloquea http plano a hosts no locales', async () => {
    await new Promise<void>((resolve) => {
      const req = http.get('http://botpress.example.com/hook', () => resolve());
      req.on('error', () => resolve());
    });
    expect(bloqueados.some((b) => b.startsWith('botpress.example.com'))).toBe(true);
  });

  it('permite tráfico local (Postgres, supertest)', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const cuerpo = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(cuerpo).toBe('ok');
    expect(bloqueados).toEqual([]);
  });
});
