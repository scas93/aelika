import { ConfigService } from '@nestjs/config';

// Base del catálogo web público de menudeo (pide.aelika.com/{slug} en
// producción) — mismo default que ya usaba InternalService.getBotConfig
// para armar `catalogoUrl` en /internal/bot-config. Extraído aquí para que
// ese endpoint y "negocio.link" (ver plantilla-variable-catalogo.ts, Reglas
// de notificación) compartan una sola fuente del default/env var, en vez de
// duplicar el string mágico en dos archivos.
const STOREFRONT_BASE_URL_DEFAULT = 'http://localhost:3000/tienda';

export function buildStorefrontUrl(configService: ConfigService, slug: string): string {
  const base = configService.get<string>('STOREFRONT_BASE_URL') ?? STOREFRONT_BASE_URL_DEFAULT;
  return `${base}/${slug}`;
}
