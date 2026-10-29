# Arquitectura

Estructura del repo, módulos del backend, estructura del frontend y piezas transversales (auth, aislamiento por tenant, módulos apagables, infraestructura). Es la referencia a la que apuntan `docs/aelika-roadmap-maestro.md` y un comentario de `backend/prisma/schema.prisma`. Los modelos de datos están en [modelo-datos.md](modelo-datos.md); el comportamiento por área, en los demás documentos (ver el mapa en `CLAUDE.md`).

## Estructura del repo

```
backend/            NestJS + Prisma (API, motor de reglas, portal, webhooks)
  prisma/           schema.prisma, migrations/, seeds (ver seeds-y-datos-demo.md), data/*.json
  src/              módulos de Nest (tabla de abajo) + scripts/ (correcciones de datos)
  scripts/          guías (README/MIGRACION) de los scripts de datos + seed puntual de Karmele
  test/             characterization/ (suite HTTP contra Postgres real) y e2e
frontend/           Next.js 16 (panel /dashboard, storefront /tienda, portal /mayoreo, lealtad)
docs/               esta documentación
bruno/              colección de peticiones (aelika-stripe)
docker-compose.yml  Postgres + Redis locales
.claude/launch.json configuraciones de dev (backend :3001, frontend :3000)
```

`Aelika - Documento de Planeacion.md` (raíz) es el documento histórico de visión.

## Infraestructura

- **Base de datos:** PostgreSQL (Prisma 7 con driver adapter `@prisma/adapter-pg`). Cliente generado en `backend/generated/prisma` (no en `node_modules`), `moduleFormat = "cjs"` por compatibilidad con la compilación CommonJS de Nest.
- **Redis:** códigos de acceso y límites del portal (`portal/codigos-store.ts`, `ioredis`), token de conexión de Telegram (`notificaciones/telegram/telegram-token.service.ts`), claves de idempotencia del portal y la cola BullMQ de notificaciones (`notificaciones/queue/`).
- **Archivos:** Cloudflare R2 (compatible S3) vía `common/r2-storage.service.ts` (fotos de producto, logos).
- **Hosting:** backend en Railway, frontend en Vercel. `main` → producción, `staging` → staging (ver `CLAUDE.md`). `start:prod` corre `prisma migrate deploy` antes de arrancar.
- **Servicios externos:** Stripe (Connect), Botpress (bot compartido y envíos de WhatsApp por webhook), Meta (plantillas), Telegram, Resend (correo), WalletWallet (pases de lealtad), Apify (Aelika Scan), PostHog (analítica del portal, solo frontend).
- **Variables de entorno del backend** (nombres, ver `backend/.env.example`): `DATABASE_URL`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `STOREFRONT_BASE_URL`, `CORS_ORIGINS`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_V2`, `API_BASE_URL`, `REDIS_URL`, `PORTAL_OTP_SECRET`, `PORTAL_CODIGO_EN_LOG`, `PORTAL_TOPE_DIARIO_NEGOCIO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `WALLETWALLET_API_KEY`, `R2_*`. Otras que lee el código y documentan sus áreas: `CONFIRMADO_AT_DESDE` (ver diseno-operacion.md), `RAILWAY_PROJECT_NAME`. Frontend: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.

## Módulos del backend (`backend/src/`)

| Módulo | Qué hace | Documento |
|---|---|---|
| `auth/` | Registro, login, JWT, `/auth/me`, cambio de contraseña, guards globales | este documento |
| `tenant/` | Configuración del negocio (`/tenant/me` solo Admin, `/tenant/negocio` Admin y Gerente), llave del bot, Stripe, modalidades | pedidos-b2c.md, stripe-pagos.md |
| `users/` | Equipo del negocio (Admin y Gerente) | este documento |
| `categories/`, `products/`, `promotions/`, `modifier-groups/`, `puntos-envio/` | Catálogo y entrega | pedidos-b2c.md |
| `public/` | Storefront B2C sin JWT: info, catálogo, checkout, puntos de envío | pedidos-b2c.md |
| `orders/` | Pedidos B2C: panel, Kanban, histórico, reembolsos, métricas | pedidos-b2c.md, stripe-pagos.md |
| `pedidos-b2b/` | Pedidos B2B, entregas, estados derivados, exportes Excel, códigos de descuento | diseno-operacion.md |
| `clientes/`, `clientes-b2b/` | Directorio de clientes (B2C) y clientes de mayoreo | modelo-datos.md, diseno-operacion.md |
| `portal/` | Portal del cliente B2B: acceso por WhatsApp, sesión, calendario, pedidos | diseno-operacion.md |
| `adopcion/` | Módulo Adopción (solo lectura, Admin, mayoreo) | diseno-operacion.md |
| `reservas/` | Ingesta de reservas de Amenitiz (hotel) | hoteles-reservas.md |
| `notificaciones/` | Canales (Telegram, correo, WhatsApp), eventos, cola BullMQ, `avisos-internos/` | notificaciones.md |
| `notificaciones-reglas/` | Motor de reglas (triggers, filtros, plantillas, barrido horario) | notificaciones.md |
| `payments/` | `GET /payments` y `/payments/export`: listado de cobros (`Payment`) del panel Pagos | stripe-pagos.md |
| `stripe/`, `webhooks/` | Cliente de Stripe; `POST /webhooks/stripe` (eventos v1 y v2) | stripe-pagos.md |
| `internal/` | Servidor-a-servidor: `bot-config`, resolución de callbacks, redirects de onboarding de Stripe | notificaciones.md, stripe-pagos.md |
| `lealtad/` | Tarjeta de sellos, QR, pase de wallet | lealtad.md |
| `aelika-scan/` | Escaneo "Lite" de presencia digital de un negocio (Instagram, Facebook, Google Maps, sitio web, NAP, scoring) | este documento |
| `health/` | `GET /health` | este documento |
| `prisma/` | `PrismaService` (crudo) y `TenantPrismaService` (por sesión) | este documento |
| `common/` | Utilidades transversales (ver abajo) | este documento |
| `scripts/` | Scripts de corrección/migración de datos (no forman parte de la app) | seeds-y-datos-demo.md |

**Aelika Scan Lite** (`aelika-scan/lite`, `POST /aelika-scan/lite`, `@Roles(DUENO)`): no pertenece a ningún negocio cliente — exige estar logueado como Admin de cualquier negocio y no usa `tenantId`. Orquesta `integrations/` (Facebook, Instagram vía Apify, Google Maps/Places, sitio web, NAP) y `scoring/`. El roadmap lo lista como Módulo 5, pendiente de definición de producto.

**Utilidades en `common/`:** `api-key.ts` (llaves), `horario.ts` (horario y `isAbiertoAhora`), `mensaje-bienvenida.ts`, `facturacion.ts`, `estado-pago.ts`, `huella-checkout.ts`, `modalidades-cobro.ts`, `modulos.ts` (módulos apagables), `telefono.ts` / `telefono-internacional.ts`, `ventana-recepcion-b2b.ts`, `xlsx.ts` / `csv.ts`, `money.ts`, `filtro-importe.ts`, `nota-linea.ts`, `storefront-url.ts`, `r2-storage.service.ts`.

## Auth, guards y aislamiento por tenant

- **Guards globales** (`APP_GUARD`): `JwtAuthGuard` + `RolesGuard`. Todo endpoint exige sesión salvo `@Public()`; los de escritura llevan `@Roles(...)`. Roles y permisos: ver `CLAUDE.md`.
- **Endpoints públicos** (`public/`, `portal/` y los de auth): `@Public()` y nunca usan `TenantPrismaService`; resuelven el tenant por `slug` con `PrismaService` crudo y filtran todo por ese `tenantId`.
- **Servidor-a-servidor:** `auth/guards/bot-auth.guard.ts` (`BotAuthGuard`): header `X-Api-Key` contra `Tenant.botApiKey`, adjunta `request.tenant`. Se usa en `/internal/bot-config`, `/internal/reservas/amenitiz` y los callbacks de Botpress. El webhook de Telegram tiene su propio guard (`telegram-webhook-secret.guard.ts`).
- **Guards por tipo de negocio** (`pedidos-b2b/tenant-b2b.guard.ts`): `TenantB2bPanelGuard` (panel B2B: solo `RETAIL_B2B`, 403), `TenantB2bPublicGuard` (público B2B, 404), `TenantB2cPublicGuard` (público B2C: rechaza también `HOTEL`, 404).
- **`TenantPrismaService`** (`prisma/tenant-prisma.service.ts`, request-scoped): extensión `tenantScopedQuery` que inyecta `tenantId` en lecturas y en la operación raíz de cada escritura. Todo modelo con `tenantId` debe registrarse ahí. No cubre: FKs recibidas en el body (hay que validar que pertenecen al tenant y devolver 404, no 403) ni escrituras anidadas (crear padre y luego hijos como operaciones raíz separadas — ver `ModifierGroupsService.create`).
- **Módulos apagables** (`common/modulos.ts`): `Tenant.modulosDesactivados` (arreglo; vacío = todo encendido) con `MODULOS = ['LEALTAD', 'CODIGOS_DESCUENTO']`. `@RequiereModulo('X')` + `ModuloActivoGuard`: con el módulo apagado, 404 en rutas públicas (mismo mensaje que un negocio inexistente) y 403 en rutas del panel. Un pedido con código de descuento se rechaza (400) si `CODIGOS_DESCUENTO` está apagado.
- **Tipo de negocio:** `Tenant.tipoStorefront` (`RETAIL_B2C` | `RETAIL_B2B` | `HOTEL`) decide qué módulos y pantallas existen; `giroNegocio` es solo segmentación interna.

## Salud y webhooks

- `GET /health` (`health/health.controller.ts`).
- `POST /webhooks/stripe` (`webhooks/stripe-webhook.controller.ts`): ver stripe-pagos.md.
- Telegram: webhook y conexión en `notificaciones/telegram/`.

## Frontend (`frontend/`)

Next.js 16.3.1, React 19, Tailwind 4 (tokens en `app/globals.css`), Vitest + Testing Library. **Next 16 tiene cambios incompatibles con versiones previas**: lee la guía en `node_modules/next/dist/docs/` antes de escribir código (regla autogenerada en `frontend/AGENTS.md`).

| Ruta | Qué es |
|---|---|
| `app/login`, `app/register` | Autenticación y alta de negocio (acepta `RETAIL_B2C`, `RETAIL_B2B`, `HOTEL`) |
| `app/dashboard/*` | Panel administrativo: `pedidos`, `pedidos-b2b` (+ `dia`, `historico`), `catalogo`, `clientes`, `pagos`, `adopcion`, `lealtad`, `notificaciones` (`seguimiento`, `recontacto`), `ajustes` (`negocio`, `equipo`, `envios`, `facturacion`, `pagos`, `notificaciones`, `conexion-whatsapp`, `codigos-descuento`, `pedidos-b2b`), `cambiar-password` |
| `app/tienda/[slug]` | Storefront público B2C (`pide.aelika.com/{slug}` es un detalle de despliegue) |
| `app/mayoreo/[slug]` | Portal del cliente B2B (+ `portal/modificar`, `portal/pedidos`, `portal/pedidos/[folio]`, `…/modificar`) |
| `app/lealtad/[slug]` | Alta pública en el programa de lealtad |
| `app/zz-preview/` | Carpeta de previsualización local sin seguimiento en git; no es una ruta de producto |

- `lib/api.ts`: cliente del panel y tipos compartidos del contrato (`METODO_PAGO_LABEL`, etc.). `lib/portal-api.ts`: cliente del portal. `lib/session*.ts`, `lib/roles.ts` (`ROLE_LABEL`), `lib/thermal-printer.ts`, `lib/horario.ts`, `lib/portal-*-modelo.ts` / `*-formato.ts` (lógica pura del portal), `lib/analitica.ts` (PostHog), `lib/stripe.ts`.
- `frontend/proxy.ts`: middleware; deja pasar `/api-portal`. `next.config.ts` reenvía `/api-portal/*` a la API (cookie de primera parte para el portal, sin DNS ni CORS).
- `app/dashboard/_components/`: componentes compartidos del panel (convenciones en [panel-admin-estilo.md](panel-admin-estilo.md)).
- `components/`: `cantidad-input.tsx`, `horario-editor.tsx` (reutilizable en registro y Configuración), `analitica-portal.tsx`.
- Imágenes de producto: `<img>` planas (no `next/image`); cada negocio trae URLs externas y `next.config.ts` no declara `remotePatterns`.

## Pruebas y scripts de datos

Comandos y advertencias: `CLAUDE.md`. Suite de caracterización: `backend/test/characterization/README.md`. Scripts de corrección de datos y sus guías: [seeds-y-datos-demo.md](seeds-y-datos-demo.md).
