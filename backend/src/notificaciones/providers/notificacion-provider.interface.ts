/**
 * Contenido de un mensaje de notificación — deliberadamente genérico entre
 * canales (no todos los campos aplican a todos los proveedores):
 *   TELEGRAM usa solo `texto`.
 *   CORREO usa `asunto` + `texto` (fallback de texto plano) + `html` (opcional).
 */
export interface NotificacionMensaje {
  asunto?: string;
  texto: string;
  html?: string;
}

export interface NotificacionEnvioResultado {
  exito: boolean;
  error?: string;
}

/**
 * Un proveedor de canal (Telegram, Correo, ...) — el worker de BullMQ solo
 * conoce esta interfaz, nunca los detalles de cada API externa. `destinatario`
 * es el chat ID (Telegram) o la dirección de correo (Correo) a donde debe
 * llegar el mensaje; `canalConfig` es el `config` (Json) guardado en
 * NotificacionCanalConfig para ese canal/tenant — cada proveedor lee de ahí
 * lo que necesite más allá del destinatario (ej. Correo lee `nombreRemitente`
 * para armar el remitente sobre el dominio fijo de Aelika, ver CorreoProvider).
 *
 * Nunca lanza — siempre resuelve con { exito, error? } para que el worker
 * pueda intentar todos los canales de un evento y reportar cada resultado
 * antes de decidir si el job completo falla.
 */
export interface NotificacionProvider {
  enviar(
    destinatario: string,
    mensaje: NotificacionMensaje,
    canalConfig: Record<string, unknown>,
  ): Promise<NotificacionEnvioResultado>;
}
