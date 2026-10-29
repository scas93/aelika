# Aelika

Plataforma SaaS multi-tenant tipo "Uber Eats Pickup, pero sin comisiones": cada negocio se da de alta, configura su catálogo y recibe pedidos por un chatbot (WhatsApp/Instagram/Facebook, un bot compartido en Botpress) y un catálogo web público, pagando solo una suscripción mensual. Hoy cubre tres tipos de negocio: **menudeo B2C** (pickup/domicilio), **mayoreo B2B** (pedidos semanales con entregas, portal para clientes) y **hotel** (reservas espejadas desde un PMS).

Este archivo es el índice: solo lo que se necesita en casi cualquier tarea. El detalle por área vive en `docs/` (ver el mapa abajo).

## Estado por módulo (2026-10-29)

| Módulo | Estado | Documento |
|---|---|---|
| Menudeo B2C: catálogo, promociones, modificadores, storefront `/tienda`, checkout, pedidos, Kanban, histórico | Operativo | docs/pedidos-b2c.md |
| Pagos con tarjeta (Stripe Connect), reembolsos, panel Pagos | Operativo | docs/stripe-pagos.md |
| Mayoreo B2B: pedidos con entregas, clientes, Entregas del día, Excel, Adopción | Operativo | docs/diseno-operacion.md |
| Portal del cliente B2B `/mayoreo` (acceso por WhatsApp, crear/ver/modificar pedido) | Operativo | docs/diseno-operacion.md |
| Hotel: reservas desde Amenitiz y reglas automáticas | Operativo | docs/hoteles-reservas.md |
| Notificaciones: canales, motor de reglas, avisos internos, bot-config | Operativo | docs/notificaciones.md |
| Lealtad (tarjeta de sellos + pase de wallet) | Operativo | docs/lealtad.md |
| Aelika Scan Lite | Existe; producto sin definir | docs/architecture.md |
| **No construido:** configurador de bot y OAuth de canales (Meta), resolución de tenant por canal (`CHANNEL_CONNECTION`), cobro de la suscripción a los negocios, impresión automática en red, Dashboard "mejorado" | — | docs/historial.md, docs/aelika-roadmap-maestro.md |
| **En construcción / diferido (B2B):** días sin entrega (festivos), en un cambio aparte; fecha de completado del pedido, diferida | En construcción | docs/diseno-operacion.md |
| **Pendiente de migración:** Etapa 1b-b (borrar columnas B2C deprecadas de `Order`) y retirar `PedidoB2b*` | Pendiente | docs/modelo-datos.md |

## Stack

- **Backend:** Node 24+, TypeScript, NestJS 11, Prisma 7 (PostgreSQL, driver `@prisma/adapter-pg`, cliente en `backend/generated/prisma`), BullMQ + Redis (cola de notificaciones, códigos y límites del portal, token de Telegram), ExcelJS (exportes `.xlsx`), `ioredis`.
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind 4, Vitest + Testing Library, PostHog (solo portal de mayoreo), Stripe Elements.
- **Servicios:** Stripe (Connect, Accounts API v2), Botpress + Meta (WhatsApp por webhook), Telegram, Resend (correo), WalletWallet (pases de lealtad), Cloudflare R2 (fotos), Apify (Aelika Scan).
- **Hosting:** backend + Postgres + Redis en Railway; frontend en Vercel. Docker Compose local (Postgres + Redis).
- **Next 16 tiene cambios incompatibles** con lo que conoces: lee `node_modules/next/dist/docs/` antes de escribir código de frontend (regla autogenerada en `frontend/AGENTS.md`; no editar `frontend/CLAUDE.md` ni `frontend/AGENTS.md`).

## Roles

Enum `Role`: `OPERADOR`, `GERENTE`, `DUENO`. **"Admin" es solo la etiqueta visible de `DUENO`** (`frontend/lib/roles.ts`, `ROLE_LABEL`); el valor interno (enum, JWT, base de datos, `@Roles`) sigue siendo `DUENO`. Operador: ver/recibir pedidos y avanzar estatus; Gerente: lo del Operador + catálogo y gestión; Dueño/Admin: todo lo anterior + configuración del negocio. Ajustes: el Gerente ve solo Información del negocio y Equipo (`/tenant/negocio`, `/users`); `/tenant/me` es solo Admin. Un Gerente no puede crear/ascender a Admin ni editar a un Admin (403). En B2B, **confirmar y cancelar pedidos es solo de Gerente/Admin**; el Operador captura, edita y cierra entregas. `GET`/`PATCH /orders` están abiertos a los 3 roles a propósito. El detalle por endpoint está en el documento de cada área.

## Multi-tenancy y convenciones núcleo

- **Base compartida con `tenantId` en cada tabla.** Lecturas y escrituras de la operación raíz van por `TenantPrismaService` (filtra por el `tenantId` de la sesión). Eso **no cubre** FKs recibidas en el body (validar que pertenecen al tenant; 404, no 403, si no) ni escrituras anidadas (crear padre y luego hijos como operaciones raíz). Todo modelo con `tenantId` se registra en ese servicio. Ver docs/architecture.md.
- **Endpoints públicos** (storefront, portal): `@Public()`, nunca `TenantPrismaService`; resuelven el tenant por `slug` con `PrismaService` crudo y filtran todo por ese `tenantId`.
- **Permisos:** `@Roles(...)` en los endpoints de escritura; `@Public()` en los que no requieren sesión; `JwtAuthGuard` + `RolesGuard` globales. **Server-to-server** (bot, Make, callbacks): `@Public()` + `BotAuthGuard` (`X-Api-Key` = `Tenant.botApiKey`), no JWT.
- **Dinero siempre `Decimal`** (`@db.Decimal`), nunca `Float`. **Nunca confiar en precios del cliente:** los carritos solo aceptan `productId` + `cantidad`; el servidor recalcula todo (el `ValidationPipe` global con `whitelist: true` descarta campos extra).
- **Nomenclatura:** campos Prisma en camelCase (`tenantId`). Las credenciales usan `crypto.randomBytes(32).toString('hex')` (`common/api-key.ts`), no UUID.
- **Folios por tenant** nunca con `MAX()+1`: advisory lock de Postgres dentro de la misma transacción (`PublicService.nextFolio`). El avance de estatus lo calcula siempre el servidor.
- **Borrado con FK entrante:** capturar `P2003` y devolver 409 con mensaje claro, no 500.
- **Orden base + detalle por tipo:** `Order` (`tipo` B2C/B2B/RESERVA) con tablas 1:1 por tipo. **Toda consulta B2C a `Order` filtra `tipo = B2C`**, y toda salida de pedido B2C pasa por `aRespuestaOrder` (nunca una fila cruda). Ver docs/modelo-datos.md.
- **Zona horaria** fija `America/Mexico_City` (vía `Intl`, nunca aritmética de offset). `Tenant.horarioAtencion` es `Json` estructurado.
- **Módulos apagables por negocio:** `Tenant.modulosDesactivados` (`LEALTAD`, `CODIGOS_DESCUENTO`); `@RequiereModulo`.

## Ramas y despliegue

- `main` → Vercel producción + Railway producción. `staging` → Vercel staging + Railway staging. Todo el trabajo se sube primero a `staging`; **nunca push directo a `main`**.
- "push a staging" = subir/mergear el trabajo actual a `staging`. "push a prod" (o variantes) = mergear `staging` → `main`.
- Railway: `start:prod` corre `prisma migrate deploy` al arrancar (las migraciones se aplican solas). **El enlace de la CLI de Railway es por directorio:** desde `backend/` puede apuntar a producción; pasa siempre `-p <project> -e <environment>` y verifica el dominio (docs/seeds-y-datos-demo.md).
- Los scripts de corrección de datos (`backend/src/scripts/`) hacen dry-run por defecto y no se corren en staging/producción sin revisar el dry-run.

## Comandos de verificación

Estado base al 2026-10-29: backend `tsc` 37 errores (todos en `test/characterization/`, 0 en `src/`); backend eslint 3253 errores y 507 advertencias (3047 son `prettier/prettier`); todo lo demás en verde (backend `jest` 281 pruebas, frontend `tsc`/eslint 0 problemas, `vitest` 342 pruebas). No introduzcas errores nuevos sobre esa base.

**Seguros de correr en cualquier momento (solo lectura, sin base de datos):**

| Dónde | Comando |
|---|---|
| backend | `npx tsc --noEmit -p tsconfig.json` (typecheck) |
| backend | `npx eslint "{src,apps,libs,test}/**/*.ts"` (lint **sin** `--fix`) |
| backend | `npm test` (jest, pruebas unitarias de `src/`, sin Postgres) |
| frontend | `npx tsc --noEmit` (typecheck) |
| frontend | `npm run lint` (eslint, no escribe) |
| frontend | `npm test` (`vitest run`) |

**Con efectos: no correr sin saber lo que hacen:**

| Comando | Advertencia |
|---|---|
| backend `npm run lint` | Lleva `--fix`: **modifica archivos** (y con la base actual reformatea miles de líneas) |
| backend `npm run format` | `prettier --write`: modifica archivos |
| backend `npm run test:char` | Necesita **Postgres local** y hace `TRUNCATE ... CASCADE` en la base `<nombre>_test` (se niega a correr si no termina en `_test` o el host no es local); sin red saliente. Ver `backend/test/characterization/README.md`. Nunca `jest -u` |
| backend `npm run test:e2e` | No verificado; asume servicios levantados |
| backend `npm run build` | `prisma generate` + `nest build`: **escribe `dist/` y `generated/prisma`** (`npm install` también regenera `generated/prisma` por `postinstall`) |
| frontend `npm run build` | Escribe `.next/` |
| backend `npm run prisma:migrate`, `prisma:seed`, `seed:*`, `start:prod` | Escriben en la base apuntada por `backend/.env` |
| `npm run start:dev` / `npm run dev` | Levantan servidores (usar `.claude/launch.json`: backend :3001, frontend :3000) |

## Mapa de documentación

Lee el documento que corresponda al área que vas a tocar (no hace falta leerlos todos):

| Si vas a tocar… | Lee |
|---|---|
| Estructura del repo, módulos del backend, auth/guards, frontend, variables de entorno | docs/architecture.md |
| `schema.prisma`, órdenes base/detalle, clientes, contadores, migraciones de columnas | docs/modelo-datos.md |
| Pedidos B2B, entregas, estados, portal `/mayoreo`, clientes B2B, Excel, Adopción (**el diseño manda**) | docs/diseno-operacion.md |
| Catálogo, promociones, modificadores, storefront `/tienda`, checkout, pedidos B2C, Ajustes del negocio | docs/pedidos-b2c.md |
| Stripe, tarjeta, reembolsos, estado de pago, huella de checkout | docs/stripe-pagos.md |
| Hotel, reservas, Amenitiz, teléfonos internacionales | docs/hoteles-reservas.md |
| Reglas de notificación, avisos internos, bot, Botpress, plantillas de WhatsApp | docs/notificaciones.md |
| Programa de lealtad | docs/lealtad.md |
| Impresión de comandas, WebUSB, impresora térmica | docs/impresion-hardware.md |
| Estilo del panel `/dashboard` (badges, controles, tablas, teléfono) | docs/panel-admin-estilo.md |
| Seeds, datos de demo, scripts de corrección de datos, Railway | docs/seeds-y-datos-demo.md |
| Contexto de producto, roadmap y módulos futuros | docs/aelika-roadmap-maestro.md |
| Por qué se hizo algo así (bitácora, **no son instrucciones**) | docs/historial.md |
| Visión original del producto (histórico) | `Aelika - Documento de Planeacion.md` |
| Pruebas de caracterización | `backend/test/characterization/README.md` |

## Precedencia cuando dos documentos difieren

1. **El código y las migraciones** dicen qué existe hoy; si un documento afirma otra cosa, el documento está desactualizado: corrígelo.
2. **Para el comportamiento funcional de B2B** (reglas de pedido, estados, roles, notificaciones) manda `docs/diseno-operacion.md` Parte I; si choca con el código o es ambiguo, repórtalo antes de implementar. Sus divergencias abiertas están en la sección 9 de ese documento.
3. Un documento de área manda sobre el roadmap y sobre `docs/historial.md`; este archivo manda solo en lo que cubre (índice y convenciones núcleo). `docs/historial.md` y `Aelika - Documento de Planeacion.md` son históricos y nunca prevalecen.
4. Lo que no se pueda verificar desde el repo (producción, staging, plantillas de Meta, entorno de Railway/Vercel) no se afirma: se registra como "por confirmar".

## Mantenimiento

Al terminar cualquier cambio que altere la estructura del repo, los modelos, las convenciones o un comportamiento documentado, **actualiza el documento correspondiente en el mismo commit** (y este índice si cambia el estado de un módulo o un comando). No agregues bitácora a este archivo: el detalle va en el documento de su área, redactado como estado vigente y con rutas que existan. No uses estados como "en local, sin desplegar": lo que está en `main` se describe tal cual; lo que depende de producción, "por confirmar".
