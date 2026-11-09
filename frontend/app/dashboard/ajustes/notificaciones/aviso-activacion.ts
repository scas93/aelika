import {
  createNotificacionEvento,
  updateNotificacionCanal,
  updateNotificacionEvento,
  type NotificacionAudiencia,
  type NotificacionCanalConfig,
  type NotificacionEvento,
  type NotificacionEventoConfig,
} from "@/lib/api";

/**
 * Un aviso de mayoreo = un canal (WhatsApp o Correo) + un evento. Para la persona es un solo interruptor: está ENCENDIDO solo si
 * el canal y el evento están activos (y el evento apunta a ese canal). Lo guardado antes de esta pantalla sigue valiendo igual.
 */
export function avisoEncendido(canal: NotificacionCanalConfig | null, evento: NotificacionEventoConfig | null): boolean {
  return Boolean(canal?.activo && evento?.activo && evento.canalConfigId === canal.id);
}

/** Enciende el aviso completo: el canal (si estaba apagado) y el evento (se crea, o se reactiva y apunta a este canal). */
export async function encenderAviso(
  token: string,
  canal: NotificacionCanalConfig,
  evento: NotificacionEventoConfig | null,
  def: { evento: NotificacionEvento; audiencia: NotificacionAudiencia },
): Promise<void> {
  if (!canal.activo) await updateNotificacionCanal(token, canal.id, { activo: true });
  if (!evento) {
    await createNotificacionEvento(token, { ...def, canalConfigId: canal.id, activo: true });
  } else if (!evento.activo || evento.canalConfigId !== canal.id) {
    await updateNotificacionEvento(token, evento.id, { activo: true, canalConfigId: canal.id });
  }
}

/** Apaga el aviso completo: primero el evento y luego el canal (cada uno solo si estaba encendido). */
export async function apagarAviso(
  token: string,
  canal: NotificacionCanalConfig | null,
  evento: NotificacionEventoConfig | null,
): Promise<void> {
  if (evento?.activo) await updateNotificacionEvento(token, evento.id, { activo: false });
  if (canal?.activo) await updateNotificacionCanal(token, canal.id, { activo: false });
}
