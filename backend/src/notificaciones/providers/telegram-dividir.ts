/** Límite de Telegram para el texto de un mensaje (sendMessage). Se mide en unidades UTF-16 (`length`), el criterio más estricto. */
export const TELEGRAM_LIMITE = 4096;

// Espacio reservado en el encabezado de cada parte: " (parte 99/99)".
const RESERVA_ENCABEZADO = ' (parte 99/99)'.length;

/**
 * Divide un recibo largo en varios mensajes consecutivos sin perder líneas. Un texto que cabe (<= límite) se
 * devuelve intacto, en una sola parte. Si no cabe, la primera línea (el encabezado con el folio, "NUEVO PEDIDO #n - …")
 * se repite en cada parte con " (parte i/n)", y el resto se reparte por líneas completas en orden, así el TOTAL
 * (la última línea con contenido) queda al final de la última parte. Una línea individual más larga que el espacio
 * disponible se corta en trozos (caso extremo; no ocurre con recibos normales).
 */
export function dividirMensajeTelegram(texto: string, limite = TELEGRAM_LIMITE): string[] {
  if (texto.length <= limite) return [texto];

  const lineas = texto.split('\n');
  const encabezado = lineas[0];
  const cuerpo = lineas.slice(1);
  const disponible = Math.max(1, limite - encabezado.length - RESERVA_ENCABEZADO - 1);

  const trozos: string[][] = [[]];
  let usado = 0;
  const empujar = (linea: string) => {
    const costo = linea.length + 1;
    if (usado + costo > disponible && trozos[trozos.length - 1].length > 0) {
      trozos.push([]);
      usado = 0;
    }
    trozos[trozos.length - 1].push(linea);
    usado += costo;
  };

  for (const linea of cuerpo) {
    if (linea.length + 1 <= disponible) {
      empujar(linea);
      continue;
    }
    for (let i = 0; i < linea.length; i += disponible - 1) {
      empujar(linea.slice(i, i + disponible - 1));
    }
  }

  // Sin líneas en blanco al borde de cada parte (no son contenido).
  const partes = trozos.map((t) => {
    while (t.length > 0 && t[0] === '') t.shift();
    while (t.length > 0 && t[t.length - 1] === '') t.pop();
    return t.join('\n');
  });
  const n = partes.length;
  return partes.map((p, i) => `${encabezado} (parte ${i + 1}/${n})\n${p}`);
}
