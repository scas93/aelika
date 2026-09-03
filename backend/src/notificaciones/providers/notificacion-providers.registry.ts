import { Injectable } from '@nestjs/common';
import { NotificacionCanalTipo } from '../../../generated/prisma/enums';
import { TelegramProvider } from './telegram.provider';
import { CorreoProvider } from './correo.provider';
import type { NotificacionProvider } from './notificacion-provider.interface';

// SMS queda pausado por decisión de producto (costo por mensaje en México y
// bajo encaje frente a WhatsApp) y WhatsApp sigue fuera de alcance — ver
// CLAUDE.md. El enum NotificacionCanalTipo ya incluye SMS (Fase A), pero
// intencionalmente no hay proveedor registrado para él todavía: cualquier
// NotificacionEventoConfig que apunte a un canal SMS activo se registrará en
// el log como sin proveedor, en vez de fallar en silencio.
@Injectable()
export class NotificacionProvidersRegistry {
  private readonly providers: Partial<Record<NotificacionCanalTipo, NotificacionProvider>>;

  constructor(telegramProvider: TelegramProvider, correoProvider: CorreoProvider) {
    this.providers = {
      [NotificacionCanalTipo.TELEGRAM]: telegramProvider,
      [NotificacionCanalTipo.CORREO]: correoProvider,
    };
  }

  get(tipo: NotificacionCanalTipo): NotificacionProvider | undefined {
    return this.providers[tipo];
  }
}
