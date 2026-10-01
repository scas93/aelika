import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import Stripe from 'stripe';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StripeService } from '../../src/stripe/stripe.service';
import { NOTIFICACIONES_QUEUE } from '../../src/notificaciones/queue/notificaciones-queue.constants';
import { NotificacionesProcessor } from '../../src/notificaciones/queue/notificaciones.processor';
import { ReglaEventoPedidoService } from '../../src/notificaciones-reglas/regla-evento-pedido.service';
import { TelegramTokenService } from '../../src/notificaciones/telegram/telegram-token.service';
import { ReglaEnvioService } from '../../src/notificaciones-reglas/regla-envio.service';
import { WalletPassService } from '../../src/lealtad/wallet-pass.service';
import { ReglaBarridoService } from '../../src/notificaciones-reglas/regla-barrido.service';

export const WEBHOOK_SECRET_V1 = 'whsec_char_v1';

/**
 * Servicios externos sustituidos. Lo que se verifica es QUÉ se les envía:
 *  - queueAdd: cola BullMQ de notificaciones (Telegram/correo se despachan
 *    desde el processor, que aquí no corre). Recibe (nombreJob, data).
 *  - stripe.*: el cliente Stripe es el real (para que la verificación de
 *    firma del webhook sea la ruta real) pero paymentIntents.create/retrieve/cancel
 *    y refunds.create son mocks — nada sale a la red. (Parte B1) Los PaymentIntent
 *    viven en `piStore` (id → objeto) y `create` respeta la llave de idempotencia
 *    (`{ idempotencyKey }`): la misma llave devuelve el MISMO PaymentIntent, como
 *    Stripe. Un test puede forzar `status`/`amount`/`transfer_data` en el store.
 *  - dispararSeguro: Reglas EVENTO_PEDIDO (Botpress nunca se contacta). Solo en el modo
 *    por defecto; con `reglasReales` el ReglaEventoPedidoService es el REAL.
 *  - reglaEnvio: frontera con Botpress (ReglaEnvioService.enviar) — siempre sustituida.
 *    Recibe (tenant, cliente, regla, contexto?).
 *  - walletCrearPase / walletActualizarPase: WalletWallet API (Lealtad) — siempre sustituida.
 */
export interface Fakes {
  queueAdd: jest.Mock;
  paymentIntentsCreate: jest.Mock;
  paymentIntentsRetrieve: jest.Mock;
  paymentIntentsCancel: jest.Mock;
  /** PaymentIntent falsos por id (Parte B1). */
  piStore: Map<string, any>;
  refundsCreate: jest.Mock;
  dispararSeguro: jest.Mock;
  reglaEnvio: jest.Mock;
  walletCrearPase: jest.Mock;
  walletActualizarPase: jest.Mock;
  reset(): void;
}

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  jwt: JwtService;
  stripe: Stripe;
  fakes: Fakes;
  close(): Promise<void>;
}

// Solo se falsea Date: setTimeout/setImmediate/nextTick/etc. siguen reales
// para no congelar timeouts del driver de Postgres ni las esperas del test.
const TODO_MENOS_DATE = [
  'nextTick',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'performance',
  'hrtime',
] as const;

export function freezeClock(iso: string) {
  jest.useFakeTimers({ now: new Date(iso), doNotFake: [...TODO_MENOS_DATE] });
}

export function restoreClock() {
  jest.useRealTimers();
}

export async function createHarness(opts: { reglasReales?: boolean } = {}): Promise<Harness> {
  const stripe = new Stripe('sk_test_characterization');
  const paymentIntentsCreate = jest.fn();
  const paymentIntentsRetrieve = jest.fn();
  const paymentIntentsCancel = jest.fn();
  const piStore = new Map<string, any>();
  const refundsCreate = jest.fn();
  (stripe.paymentIntents as any).create = paymentIntentsCreate;
  (stripe.paymentIntents as any).retrieve = paymentIntentsRetrieve;
  (stripe.paymentIntents as any).cancel = paymentIntentsCancel;
  (stripe.refunds as any).create = refundsCreate;

  const queueAdd = jest.fn().mockResolvedValue(undefined);
  const dispararSeguro = jest.fn().mockResolvedValue(undefined);
  const reglaEnvio = jest.fn();
  const walletCrearPase = jest.fn();
  const walletActualizarPase = jest.fn();

  const fakes: Fakes = {
    queueAdd,
    paymentIntentsCreate,
    paymentIntentsRetrieve,
    paymentIntentsCancel,
    piStore,
    refundsCreate,
    dispararSeguro,
    reglaEnvio,
    walletCrearPase,
    walletActualizarPase,
    reset() {
      queueAdd.mockReset().mockResolvedValue(undefined);
      dispararSeguro.mockReset().mockResolvedValue(undefined);
      let n = 0;
      piStore.clear();
      const porLlave = new Map<string, string>();
      paymentIntentsCreate.mockReset().mockImplementation(async (params: any, opts?: { idempotencyKey?: string }) => {
        const llave = opts?.idempotencyKey;
        if (llave && porLlave.has(llave)) return piStore.get(porLlave.get(llave)!);
        n += 1;
        const pi = {
          id: `pi_char_${n}`,
          client_secret: `pi_char_${n}_secret_x`,
          status: 'requires_payment_method',
          amount: params?.amount,
          transfer_data: params?.transfer_data,
        };
        piStore.set(pi.id, pi);
        if (llave) porLlave.set(llave, pi.id);
        return pi;
      });
      paymentIntentsRetrieve.mockReset().mockImplementation(async (id: string) => {
        const pi = piStore.get(id);
        if (!pi) throw Object.assign(new Error(`No such payment_intent: ${id}`), { code: 'resource_missing' });
        return pi;
      });
      paymentIntentsCancel.mockReset().mockImplementation(async (id: string) => {
        const pi = piStore.get(id);
        if (!pi) throw Object.assign(new Error(`No such payment_intent: ${id}`), { code: 'resource_missing' });
        if (pi.status === 'succeeded' || pi.status === 'canceled') {
          throw Object.assign(new Error(`cannot cancel a ${pi.status} payment_intent`), { code: 'payment_intent_unexpected_state' });
        }
        pi.status = 'canceled';
        return pi;
      });
      refundsCreate.mockReset().mockResolvedValue({ id: 're_char_1' });
      reglaEnvio.mockReset().mockResolvedValue({ id: 'envio-char' });
      let w = 0;
      walletCrearPase.mockReset().mockImplementation(async () => {
        w += 1;
        return {
          serialNumber: `serial-char-${w}`,
          googleSaveUrl: `https://wallet.test/google/${w}`,
          applePass: `apple-pass-${w}`,
          shareUrl: `https://wallet.test/share/${w}`,
        };
      });
      walletActualizarPase.mockReset().mockResolvedValue(null);
    },
  };
  fakes.reset();

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getQueueToken(NOTIFICACIONES_QUEUE))
    .useValue({ add: queueAdd })
    .overrideProvider(NotificacionesProcessor)
    .useValue({})
    .overrideProvider(StripeService)
    .useValue({ client: stripe })
    // Abre su propio cliente ioredis (REDIS_URL): se sustituye para que ningún
    // test toque Redis ni deje reintentos de conexión vivos.
    .overrideProvider(TelegramTokenService)
    .useValue({})
    .overrideProvider(ReglaEnvioService)
    .useValue({ enviar: reglaEnvio })
    .overrideProvider(WalletPassService)
    .useValue({ crearPase: walletCrearPase, actualizarPase: walletActualizarPase })
    .overrideProvider(ReglaBarridoService)
    .useValue({});
  if (!opts.reglasReales) {
    builder = builder.overrideProvider(ReglaEventoPedidoService).useValue({ dispararSeguro });
  }
  const moduleRef = await builder.compile();

  // Igual que main.ts: rawBody para verificar la firma de Stripe + el mismo
  // ValidationPipe global (whitelist descarta precios que mande el cliente).
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Escucha UNA vez, explícitamente en 127.0.0.1 (puerto efímero). Si no, supertest hace `listen(0)` por cada
  // petición: Node enlaza en `::` (doble pila) y, en macOS, un proceso ajeno que ya tenga 127.0.0.1:<mismo puerto>
  // (aquí: los reenvíos SSH de Lima/Docker, que devuelven un banner "SSH-2.0-OpenSSH…") gana las conexiones a
  // 127.0.0.1 → el cliente HTTP falla con "Parse Error: Expected HTTP/, RTSP/ or ICE/". Fallaba ~1 de cada
  // 6000 peticiones (≈1 de cada 6 corridas completas), en tests distintos cada vez. Con un enlace exacto a
  // 127.0.0.1 el sistema nunca entrega un puerto que otro proceso tenga ahí, y supertest reutiliza este servidor.
  await app.listen(0, '127.0.0.1');

  return {
    app,
    prisma: app.get(PrismaService),
    jwt: app.get(JwtService),
    stripe,
    fakes,
    close: () => app.close(),
  };
}

/**
 * Espera determinística (sin sleep): cede el event loop hasta que el mock
 * haya recibido `veces` llamadas. Para lo fire-and-forget (`void ...`) que
 * termina después de la respuesta HTTP.
 */
export async function waitForCalls(mock: jest.Mock, veces = 1, timeoutMs = 5000) {
  const inicio = process.hrtime.bigint();
  while (mock.mock.calls.length < veces) {
    if (Number(process.hrtime.bigint() - inicio) / 1e6 > timeoutMs) {
      throw new Error(`waitForCalls: se esperaban ${veces} llamada(s), hubo ${mock.mock.calls.length}`);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
