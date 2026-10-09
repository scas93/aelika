import { ConfigService } from '@nestjs/config';
import { TipoStorefront } from '../../generated/prisma/enums';

// Base del catálogo web público de menudeo (pide.aelika.com/{slug} en
// producción) — mismo default que ya usaba InternalService.getBotConfig
// para armar `catalogoUrl` en /internal/bot-config. Extraído aquí para que
// ese endpoint y "negocio.link" (ver plantilla-variable-catalogo.ts, Reglas
// de notificación) compartan una sola fuente del default/env var, en vez de
// duplicar el string mágico en dos archivos.
const STOREFRONT_BASE_URL_DEFAULT = 'http://localhost:3000/tienda';

/**
 * Link público que ve el cliente final.
 *  - Menudeo (B2C): `{STOREFRONT_BASE_URL}/{slug}` (la base normalmente termina en /tienda), como siempre.
 *  - Mayoreo (B2B): `{origen}/{slug}` — solo el ORIGEN de STOREFRONT_BASE_URL, sin /tienda ni /mayoreo en la ruta; el proxy
 *    del frontend (y la redirección de /tienda/[slug]) llevan al storefront de mayoreo. Funciona igual si la variable
 *    termina en /tienda, en "/" o no tiene ruta.
 */
export function buildStorefrontUrl(configService: ConfigService, slug: string, tipoStorefront?: TipoStorefront): string {
  const base = configService.get<string>('STOREFRONT_BASE_URL') ?? STOREFRONT_BASE_URL_DEFAULT;
  if (tipoStorefront === TipoStorefront.RETAIL_B2B) {
    return `${origenDe(base)}/${slug}`;
  }
  return `${base}/${slug}`;
}

function origenDe(base: string): string {
  try {
    return new URL(base).origin;
  } catch {
    // Valor sin esquema (ej. "pide.aelika.com/tienda"): se quita la ruta a mano.
    return base.replace(/\/+$/, '').replace(/\/(tienda|mayoreo)$/, '');
  }
}
