/**
 * Teléfonos internacionales (reservas de hotel y envío por WhatsApp). `normalizarTelefono` (telefono.ts) NO cambia: sigue
 * truncando a 10 dígitos para México y lo usan checkout B2C, portal B2B y Lealtad. Esta función es aparte.
 *
 * Formato de guardado:
 *  - México: exactamente 10 dígitos, sin "+" (idéntico a hoy).
 *  - Cualquier otro país: "+" + código de país + número, completo (ej. "+18188140000"). El "+" distingue un internacional
 *    de un mexicano aunque ambos tengan 10 dígitos en total.
 *
 * Reglas de interpretación (se ignoran espacios, guiones, paréntesis y puntos):
 *  - Con "+" (o prefijo "00"/"011"): se respeta el código de país. "+52" seguido de 10 dígitos (o "+521" + 10, formato
 *    viejo de celular) es México y se guarda como 10 dígitos; un "+52" con otra longitud se conserva completo como "+52…".
 *  - Sin "+": 10 dígitos → México; 12 dígitos que empiezan con 52 → México; 13 que empiezan con 521 → México;
 *    11 que empiezan con 1 → EE. UU./Canadá ("+1…"); 8–9 dígitos → se dejan tal cual (como hoy); cualquier otra longitud
 *    mayor a 10 → internacional ("+" + dígitos). Un número de EE. UU. de 10 dígitos sin código no se puede distinguir de un
 *    mexicano y se trata como México (limitación conocida).
 *  - Inutilizable (devuelve null): vacío, menos de 8 dígitos, más de 15 (E.164) o todos los dígitos idénticos (placeholders
 *    de Expedia/Hotels.com como "+1 1111111111").
 */
export function normalizarTelefonoInternacional(crudo: string | null | undefined): string | null {
  if (!crudo) return null;
  const texto = crudo.trim();
  let digitos = texto.replace(/\D/g, '');
  let conMas = texto.startsWith('+');
  if (!conMas && digitos.startsWith('00')) {
    digitos = digitos.slice(2);
    conMas = true;
  } else if (!conMas && digitos.startsWith('011') && digitos.length > 10) {
    digitos = digitos.slice(3);
    conMas = true;
  }

  if (digitos.length < 8 || digitos.length > 15 || /^(\d)\1+$/.test(digitos)) return null;

  if (conMas) {
    if (digitos.startsWith('52')) {
      let resto = digitos.slice(2);
      if (resto.length === 11 && resto.startsWith('1')) resto = resto.slice(1);
      if (resto.length === 10) return resto;
    }
    return `+${digitos}`;
  }

  if (digitos.length === 10) return digitos;
  if (digitos.length === 12 && digitos.startsWith('52')) return digitos.slice(2);
  if (digitos.length === 13 && digitos.startsWith('521')) return digitos.slice(3);
  if (digitos.length === 11 && digitos.startsWith('1')) return `+${digitos}`;
  if (digitos.length < 10) return digitos;
  return `+${digitos}`;
}

const LADA_PAIS_DEFAULT = '+52';

/** Número listo para Botpress/Meta: un guardado con "+" ya es completo; uno mexicano de 10 dígitos lleva "+52". */
export function telefonoParaEnvio(guardado: string): string {
  return guardado.startsWith('+') ? guardado : `${LADA_PAIS_DEFAULT}${guardado}`;
}
