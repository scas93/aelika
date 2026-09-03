import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { generateApiKey } from '../../common/api-key';

// 15 minutos — suficiente para que el Dueño haga click en el link y le dé
// "Iniciar" en Telegram sin apuro, corto porque el token, una vez usado o
// vencido, ya no debe servir para "robar" la conexión de otro tenant si
// alguien más lo intercepta.
const TTL_SEGUNDOS = 15 * 60;
const KEY_PREFIX = 'notificaciones:telegram:conectar:';

/**
 * Store efímero de un solo uso para el token de conexión de Telegram —
 * Redis en vez de una tabla de Postgres a propósito: es estado de vida
 * corta (15 min) que no necesita historial ni ser consultable después de
 * usarse, mismo tipo de dato que ya vive en Redis para BullMQ (ver
 * NotificacionesModule). Usa un cliente ioredis propio, separado de la
 * conexión que administra internamente @nestjs/bullmq, para no acoplar
 * esto a la cola.
 */
@Injectable()
export class TelegramTokenService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(configService: ConfigService) {
    this.redis = new Redis(configService.getOrThrow<string>('REDIS_URL'));
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async generar(tenantId: string): Promise<string> {
    const token = generateApiKey();
    await this.redis.set(KEY_PREFIX + token, tenantId, 'EX', TTL_SEGUNDOS);
    return token;
  }

  /**
   * Resuelve y consume el token en una sola operación atómica (GETDEL) — si
   * dos updates de Telegram llegaran con el mismo token (reintento de
   * Telegram, doble click), el segundo ya no lo encuentra, evitando una
   * condición de carrera que reconecte el chat equivocado.
   */
  async resolverYConsumir(token: string): Promise<string | null> {
    return this.redis.getdel(KEY_PREFIX + token);
  }
}
