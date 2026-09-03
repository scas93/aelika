/**
 * Subconjunto mínimo del Update de la Bot API de Telegram que este webhook
 * necesita — solo mensajes de texto entrantes (el `/start <token>` que
 * Telegram manda cuando el usuario abre el deep link y le da "Iniciar").
 * https://core.telegram.org/bots/api#update
 */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number; type: string };
    text?: string;
  };
}
