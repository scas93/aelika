import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const CODIGOS_STORE = Symbol('CODIGOS_STORE');

export type ResultadoVerificacion =
  'OK' | 'INCORRECTO' | 'AGOTADO' | 'NO_EXISTE';

/**
 * Estado efímero del acceso al portal: códigos de un solo uso (solo su HMAC) y contadores de límites. Detrás de una
 * interfaz para poder sustituirlo en pruebas. Toda implementación debe FALLAR (lanzar) si el almacén no responde:
 * el servicio de acceso falla cerrado y nadie puede pedir ni verificar códigos.
 */
export interface CodigosStore {
  /** Guarda el hash del código (reemplaza el anterior) con vigencia y 0 intentos. */
  guardarCodigo(
    clave: string,
    hash: string,
    ttlSegundos: number,
  ): Promise<void>;
  /**
   * Verifica de forma atómica. Cada intento consume 1 de `maxIntentos`. El código se borra al acertar y al agotar
   * los intentos. Si no existe (vencido, usado o nunca pedido) → NO_EXISTE.
   */
  verificarCodigo(
    clave: string,
    hash: string,
    maxIntentos: number,
  ): Promise<ResultadoVerificacion>;
  /** Suma 1 al contador (el TTL se fija al crearlo) y devuelve el valor nuevo. */
  incrementar(clave: string, ttlSegundos: number): Promise<number>;
  /** Idempotencia (4d): guarda `valor` solo si la clave no existe. true = quedó reservada por este llamador. */
  reservar(clave: string, valor: string, ttlSegundos: number): Promise<boolean>;
  leer(clave: string): Promise<string | null>;
  escribir(clave: string, valor: string, ttlSegundos: number): Promise<void>;
  borrar(clave: string): Promise<void>;
}

// KEYS[1] = clave; ARGV[1] = hash candidato; ARGV[2] = máximo de intentos.
const LUA_VERIFICAR = `
local h = redis.call('HGET', KEYS[1], 'h')
if not h then return 'NO_EXISTE' end
local intentos = tonumber(redis.call('HGET', KEYS[1], 'i') or '0')
local max = tonumber(ARGV[2])
if intentos >= max then
  redis.call('DEL', KEYS[1])
  return 'AGOTADO'
end
intentos = intentos + 1
if h == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 'OK'
end
if intentos >= max then
  redis.call('DEL', KEYS[1])
  return 'AGOTADO'
end
redis.call('HSET', KEYS[1], 'i', intentos)
return 'INCORRECTO'
`;

const LUA_INCREMENTAR = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

@Injectable()
export class RedisCodigosStore implements CodigosStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(url: string) {
    // Sin cola offline y con timeouts cortos: si Redis no responde, el comando falla rápido (falla cerrado).
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      commandTimeout: 2000,
    });
    this.redis.on('error', () => undefined);
  }

  async guardarCodigo(clave: string, hash: string, ttlSegundos: number) {
    await this.redis
      .multi()
      .del(clave)
      .hset(clave, 'h', hash, 'i', 0)
      .expire(clave, ttlSegundos)
      .exec();
  }

  async verificarCodigo(clave: string, hash: string, maxIntentos: number) {
    const r = await this.redis.eval(
      LUA_VERIFICAR,
      1,
      clave,
      hash,
      String(maxIntentos),
    );
    return r as ResultadoVerificacion;
  }

  async incrementar(clave: string, ttlSegundos: number) {
    return Number(
      await this.redis.eval(LUA_INCREMENTAR, 1, clave, String(ttlSegundos)),
    );
  }

  async reservar(clave: string, valor: string, ttlSegundos: number) {
    return (
      (await this.redis.set(clave, valor, 'EX', ttlSegundos, 'NX')) === 'OK'
    );
  }

  async leer(clave: string) {
    return this.redis.get(clave);
  }

  async escribir(clave: string, valor: string, ttlSegundos: number) {
    await this.redis.set(clave, valor, 'EX', ttlSegundos);
  }

  async borrar(clave: string) {
    await this.redis.del(clave);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}

/** Implementación en memoria: pruebas y desarrollo sin Redis. Usa Date.now() (sigue el reloj falso de la suite). */
export class MemoriaCodigosStore implements CodigosStore {
  /** Pruebas: simula Redis caído (todas las operaciones fallan). */
  caido = false;
  private codigos = new Map<
    string,
    { hash: string; intentos: number; venceMs: number }
  >();
  private contadores = new Map<string, { n: number; venceMs: number }>();
  private textos = new Map<string, { valor: string; venceMs: number }>();

  reset() {
    this.caido = false;
    this.codigos.clear();
    this.contadores.clear();
    this.textos.clear();
  }

  private caer(): Promise<never> {
    return Promise.reject(new Error('Redis no disponible (simulado)'));
  }

  guardarCodigo(
    clave: string,
    hash: string,
    ttlSegundos: number,
  ): Promise<void> {
    if (this.caido) return this.caer();
    this.codigos.set(clave, {
      hash,
      intentos: 0,
      venceMs: Date.now() + ttlSegundos * 1000,
    });
    return Promise.resolve();
  }

  verificarCodigo(
    clave: string,
    hash: string,
    maxIntentos: number,
  ): Promise<ResultadoVerificacion> {
    if (this.caido) return this.caer();
    const c = this.codigos.get(clave);
    if (!c || c.venceMs <= Date.now()) {
      this.codigos.delete(clave);
      return Promise.resolve('NO_EXISTE');
    }
    if (c.intentos >= maxIntentos) {
      this.codigos.delete(clave);
      return Promise.resolve('AGOTADO');
    }
    c.intentos += 1;
    if (c.hash === hash) {
      this.codigos.delete(clave);
      return Promise.resolve('OK');
    }
    if (c.intentos >= maxIntentos) {
      this.codigos.delete(clave);
      return Promise.resolve('AGOTADO');
    }
    return Promise.resolve('INCORRECTO');
  }

  incrementar(clave: string, ttlSegundos: number): Promise<number> {
    if (this.caido) return this.caer();
    const ahora = Date.now();
    const c = this.contadores.get(clave);
    if (!c || c.venceMs <= ahora) {
      this.contadores.set(clave, { n: 1, venceMs: ahora + ttlSegundos * 1000 });
      return Promise.resolve(1);
    }
    c.n += 1;
    return Promise.resolve(c.n);
  }

  private vigente(clave: string): string | null {
    const t = this.textos.get(clave);
    if (!t || t.venceMs <= Date.now()) {
      this.textos.delete(clave);
      return null;
    }
    return t.valor;
  }

  reservar(
    clave: string,
    valor: string,
    ttlSegundos: number,
  ): Promise<boolean> {
    if (this.caido) return this.caer();
    if (this.vigente(clave) !== null) return Promise.resolve(false);
    this.textos.set(clave, { valor, venceMs: Date.now() + ttlSegundos * 1000 });
    return Promise.resolve(true);
  }

  leer(clave: string): Promise<string | null> {
    if (this.caido) return this.caer();
    return Promise.resolve(this.vigente(clave));
  }

  escribir(clave: string, valor: string, ttlSegundos: number): Promise<void> {
    if (this.caido) return this.caer();
    this.textos.set(clave, { valor, venceMs: Date.now() + ttlSegundos * 1000 });
    return Promise.resolve();
  }

  borrar(clave: string): Promise<void> {
    if (this.caido) return this.caer();
    this.textos.delete(clave);
    return Promise.resolve();
  }
}
