import * as net from 'node:net';

/**
 * Garantía de "cero red saliente": todo socket (http, https, tls, fetch/undici,
 * Stripe, Resend, Telegram, Botpress...) pasa por net.Socket.prototype.connect,
 * así que ahí se bloquea cualquier host que no sea local (Postgres y el
 * servidor efímero de supertest sí son locales). Cada intento se registra en
 * `bloqueados`; after-env.ts hace fallar el test que lo provocó aunque el
 * código bajo prueba haya tragado el error (encolarSeguro, try/catch...).
 */
const LOCALES = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

const g = globalThis as unknown as { __CHAR_RED_BLOQUEADA__?: string[]; __CHAR_RED_INSTALADA__?: boolean };
export const bloqueados: string[] = (g.__CHAR_RED_BLOQUEADA__ ??= []);

export function instalarBloqueoDeRed() {
  if (g.__CHAR_RED_INSTALADA__) return;
  g.__CHAR_RED_INSTALADA__ = true;

  const original = net.Socket.prototype.connect;
  (net.Socket.prototype as any).connect = function (this: net.Socket, ...args: any[]) {
    const primero = Array.isArray(args[0]) ? args[0][0] : args[0];
    let host: string | undefined;
    let esRutaUnix = false;
    if (primero && typeof primero === 'object') {
      esRutaUnix = Boolean(primero.path);
      host = primero.host ?? 'localhost';
    } else if (typeof primero === 'string' && Number.isNaN(Number(primero))) {
      esRutaUnix = true;
    } else {
      host = typeof args[1] === 'string' ? args[1] : 'localhost';
    }
    if (!esRutaUnix && host && !LOCALES.has(host)) {
      const detalle = `${host}:${primero?.port ?? args[0]}`;
      bloqueados.push(detalle);
      // Falla como una conexión rechazada (asíncrona), no como excepción
      // síncrona: así se comporta igual que un error de red real para el
      // código bajo prueba, y after-env.ts sigue haciendo fallar el test.
      const error = new Error(`[characterization] Llamada de red saliente bloqueada: ${detalle}`);
      process.nextTick(() => this.destroy(error));
      return this;
    }
    return original.apply(this, args as any);
  };
}
