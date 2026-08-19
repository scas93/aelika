// Applied when reading, never stored — an empty mensajeBienvenida in the DB
// just means "the Dueño hasn't customized it yet", not "blank on purpose".
// Shared by TenantService (panel) and InternalService (bot) so both resolve
// the same default instead of drifting.
export const MENSAJE_BIENVENIDA_DEFAULT = '¡Hola! ¿En qué te podemos ayudar?';

export function resolverMensajeBienvenida(value: string | null): string {
  return value || MENSAJE_BIENVENIDA_DEFAULT;
}
