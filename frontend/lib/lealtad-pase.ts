// El backend entrega el link de la tarjeta en `pase.shareUrl`, pero la respuesta
// de un sello/canje (PUT de WalletWallet) no lo trae, y un `pase` sin link no
// debe mostrarse, copiarse ni usarse para redirigir. Devuelve el link solo si
// es una URL http(s) válida; si no, null.
export function linkTarjeta(pase: { shareUrl?: string | null } | null | undefined): string | null {
  const crudo = pase?.shareUrl;
  if (typeof crudo !== "string" || !crudo.trim()) return null;
  try {
    const url = new URL(crudo.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
