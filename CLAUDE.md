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
| Días sin entrega (festivos) B2B: lista por negocio que bloquea fechas en el portal y el panel | Operativo | docs/diseno-operacion.md |
| **Diferido (B2B):** fecha de completado del pedido | Diferido | docs/diseno-operacion.md |
| **Pendiente de migración:** Etapa 1b-b (borrar columnas B2C deprecadas de `Order`) y retirar `PedidoB2b*` | Pendiente | docs/modelo-datos.md |

## Stack

- **Backend:** Node 24+, TypeScript, NestJS 11, Prisma 7 (PostgreSQL, driver `@prisma/adapter-pg`, cliente en `backend/generated/prisma`), BullMQ + Redis (cola de notificaciones, códigos y límites del portal, token de Telegram), ExcelJS (exportes `.xlsx`), `ioredis`.
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind 4, Vitest + Testing Library, PostHog (solo portal de mayoreo), Stripe Elements.
- **Servicios:** Stripe (Connect, Accounts API v2), Botpress + Meta (WhatsApp por webhook), Telegram, Resend (correo), WalletWallet (pases de lealtad), Cloudflare R2 (fotos), Apify (Aelika Scan).
- **Hosting:** backend + Postgres + Redis en Railway; frontend en Vercel. Docker Compose local (Postgres + Redis).
- **Next 16 tiene cambios incompatibles** con lo que conoces: lee `node_modules/next/dist/docs/` antes de escribir código de frontend (regla autogenerada en `frontend/AGENTS.md`; no editar `frontend/CLAUDE.md` ni `frontend/AGENTS.md`).

## Roles

Enum `Role`: `OPERADOR`, `GERENTE`, `DUENO`. **"Admin" es solo la etiqueta visible de `DUENO`** (`frontend/lib/roles.ts`, `ROLE_LABEL`); el valor interno (enum, JWT, base de datos, `@Roles`) sigue siendo `DUENO`. Operador: ver/recibir pedidos y avanzar estatus; Gerente: lo del Operador + catálogo y gestión; Dueño/Admin: todo lo anterior + configuración del negocio. Ajustes: el Gerente ve solo Información del negocio, Equipo y (mayoreo) Días sin entrega (`/tenant/negocio`, `/users`, `/dias-sin-entrega`); `/tenant/me` es solo Admin. Un Gerente no puede crear/ascender a Admin ni editar a un Admin (403). En B2B, **confirmar y cancelar pedidos es solo de Gerente/Admin**; el Operador captura, edita y cierra entregas. `GET`/`PATCH /orders` están abiertos a los 3 roles a propósito. El detalle por endpoint está en el documento de cada área.

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

## Avisos internos por WhatsApp (mayoreo) y login con `?next=`

Operativo en producción desde el 2026-10-29. Detalle ampliado en docs/notificaciones.md (sección «Avisos internos por WhatsApp»).

**Qué son.** Avisos al equipo del negocio (destinatarios fijos que se capturan en Ajustes, **no** son `Cliente`) cuando un cliente B2B modifica su pedido desde el portal `/mayoreo`. Hoy hay un solo evento: `PEDIDO_MODIFICADO_CLIENTE`. No pasan por el motor de reglas ni por la cola BullMQ.

**Dónde vive** (`backend/src/notificaciones/avisos-internos/`):
- `AvisosInternosModule` (lo importa `PortalModule`), `AvisoPedidoModificadoService` (disparo, registro, callback), `AvisoWebhookClient` (único `fetch` al webhook de Botpress: `POST` a `Tenant.botWebhookUrl`, header `x-bp-secret` solo si hay `botWebhookSecret`, timeout de 10 s), `aviso-pedido-modificado.ts` (constantes y `construirPayloadAviso`) y `AvisosPedidoCallbackController`.
- Reglas de configuración: `notificaciones/notificacion-whatsapp.ts` (forma y validación del `config`) y `notificaciones/notificacion-reglas-negocio.ts` (qué canal/evento corresponde a qué tipo de negocio); los usan `NotificacionCanalConfigService` y `NotificacionEventoConfigService`.

**Cuándo se dispara.** `PortalModificarPedidoService.modificar` lee `Order.modificadoPorClienteAt` con el pedido bloqueado **dentro** de la transacción y la devuelve como `marcaPrevia`. Solo si la edición pasa esa marca de `null` a una fecha (primera edición desde que se prendió; una edición que solo cambia la nota también cuenta; una sin cambios reales devuelve `resultado === null` y no avisa) se llama `avisarSeguro({ tenantId, orderId })` **después del commit**. Con la marca ya prendida no se vuelve a avisar hasta que se apague. Las acciones del panel (confirmar, marcar revisado, editar) no avisan.

**Condiciones para enviar** (todas, en este orden; si falla una se omite con un log `Aviso interno omitido`): el negocio es `RETAIL_B2B`; existe `NotificacionEventoConfig` activo con `evento = PEDIDO_MODIFICADO_CLIENTE`, `audiencia = NEGOCIO` y canal `WHATSAPP` activo; el canal tiene ≥1 destinatario; `Tenant.botWebhookUrl` no está vacío; el pedido existe, es `B2B` y tiene detalle. Se lee la lista de destinatarios vigente al momento del envío.

**Envío.** En segundo plano, en proceso, **sin cola ni reintentos**: `avisarSeguro` devuelve de inmediato y nunca lanza; cualquier error se traga con un log sin mensaje ni URL (solo `tipo`). Un destinatario por envío, con 4 en paralelo (`CONCURRENCIA_AVISOS`). Un fallo de un destinatario no impide los demás, y `FALLO` es definitivo. Si el proceso muere antes de enviar, el aviso se pierde (aceptado). Una falla en el aviso nunca afecta la edición del pedido ni la respuesta al cliente.

**Modelo.**
- `NotificacionCanalTipo` ganó `WHATSAPP` y `NotificacionEvento` ganó `PEDIDO_MODIFICADO_CLIENTE`. `NotificacionCanalConfig.config` de un canal `WHATSAPP` es `{ destinatarios: [{ id, nombre, telefono }] }`: 0–10 elementos, `nombre` obligatorio (≤60 caracteres), `telefono` normalizado (sin `+` se aceptan exactamente 10 dígitos de México y se guardan en 10 dígitos —`+52…` y `+521…` también—; otros países exigen `+` y código de país, 8–15 dígitos), sin teléfonos repetidos ya normalizados; `id` UUID estable (se conserva si llega válido y único, si no se genera); cualquier otra llave se descarta. Único lugar de validación: `validarConfigWhatsapp` (alta y edición).
- Un canal `WHATSAPP` **activo** exige ≥1 destinatario (409) y, al activarlo (alta activa o apagado→encendido), `Tenant.botWebhookUrl` no vacía (409); editar destinatarios de uno ya activo no revisa el webhook. El secreto del webhook es opcional.
- Tabla `avisos_internos_envios` (`AvisoInternoEnvio`), una fila por destinatario y envío: `id` (= `correlacionId` que viaja a Botpress), `tenantId` (Cascade), `orderId` y `canalConfigId` (nulables, `SetNull`), `evento`, snapshots `folio`/`negocioNombre`/`destinatarioNombre`, `destinatarioId`, `telefonoUltimos4`, `estado` (`EstadoAvisoInterno`: `EN_CURSO` por defecto, `EXITO`, `FALLO`), `motivo`, `createdAt`, `resueltoAt`. **Del teléfono solo se guardan los últimos 4 dígitos**; el número completo solo viaja en el POST a Botpress y nunca en tabla ni logs. Estado final inmutable; un `EN_CURSO` sin callback se queda así (no hay barrido). Si no se puede registrar la fila, ese destinatario no se envía.
- Migraciones: `20261028120000_notificacion_whatsapp_enums` (solo los dos `ALTER TYPE … ADD VALUE`, aislada porque un valor nuevo de enum no se puede usar en la misma transacción) y `20261028130000_avisos_internos_envios` (enum, tabla, 2 índices y 3 FK; aditiva). **Riesgo de reversa:** Postgres no permite quitar valores de un enum; revertir la primera exige recrear los tipos y fallaría si ya hay filas con `WHATSAPP` o `PEDIDO_MODIFICADO_CLIENTE`. Tratarla como irreversible en la práctica; la segunda sí se puede revertir con `DROP TABLE` + `DROP TYPE`.

**Reglas por tipo de negocio** (Ajustes → Canales de notificación; las aplica el backend, la pantalla solo las refleja):
- **Mayoreo** (`RETAIL_B2B`): solo canal `WHATSAPP` y solo el evento `PEDIDO_MODIFICADO_CLIENTE` con audiencia `NEGOCIO`. Crear/editar Telegram o Correo, o un evento de menudeo → 403; audiencia `CLIENTE` con el evento nuevo → 400. `GET` solo lista WhatsApp y el evento nuevo; filas viejas de otros canales/eventos no se borran, no se muestran ni se editan, pero sí se pueden borrar.
- **Menudeo y Hotel** (todo lo que no es `RETAIL_B2B`): canal `WHATSAPP` y evento nuevo → 403 aunque haya webhook; Telegram, Correo y los eventos de menudeo siguen igual. Una combinación evento-canal inválida (evento nuevo con canal no WhatsApp, o WhatsApp con evento de menudeo) → 400.
- **409:** segundo canal del mismo tipo para el negocio (`@@unique([tenantId, tipo])`) y evento+audiencia+canal repetido. Un `canalConfigId` de otro negocio → 404. Gestión de canales y eventos: solo Admin (Gerente y Operador 403).

**Contrato con Botpress.** `POST Tenant.botWebhookUrl` con:
```json
{ "tipo": "AVISO_INTERNO", "correlacionId": "<AvisoInternoEnvio.id>", "negocio": "<slug>",
  "telefono": "<telefonoParaEnvio(guardado)>", "categoria": "UTILITY",
  "plantilla": { "nombre": "pedido_modificado_cliente", "idioma": "es_MX" },
  "variables": ["<negocioNombre del pedido, saneado para Meta>", "<semana: «28 de septiembre»>"],
  "boton": { "tipo": "URL_DINAMICA", "indice": 0, "valor": "dashboard/pedidos-b2b?pedido=<orderId>" } }
```
El valor del botón es ruta fija sin dominio ni `/` inicial + id (el dominio va fijo en la plantilla de Meta) y no se sanea. Si Botpress responde no-2xx, hay error de red o vence el timeout, el envío queda `FALLO` (motivo `HTTP <status>`, `Error de red` o timeout); una respuesta 2xx lo deja `EN_CURSO` hasta el callback.
Callback: `PATCH /internal/avisos-pedido/:correlacionId/estado`, `@Public()` + `BotAuthGuard` (`X-Api-Key` = `Tenant.botApiKey`), body `{ "estado": "EXITO" | "FALLO", "motivo"?: string (≤500) }`, responde `200 { id, estado }` con el estado vigente (repetido o tardío = no-op; un `EXITO` tardío no pisa un `FALLO` ni al revés); el motivo se sanea con `sanearMotivo`; 404 igual para inexistente, mal formado o de otro negocio; 401 sin llave válida; 400 con cuerpo inválido.
**Tres rutas de callback, una misma llave** (`Tenant.botApiKey`): `/internal/reglas-envios/:id/estado` (envíos de reglas → `ReglaEnvioLog`), `/internal/portal-codigos/:correlacionId/estado` (código de acceso del portal) y `/internal/avisos-pedido/:id/estado` (avisos internos → `AvisoInternoEnvio`). Cada una tiene su tabla; Botpress se distingue por el `tipo: "AVISO_INTERNO"` del payload (y por la ruta de callback que usa), y el `correlacionId` solo se resuelve contra la tabla de su ruta.

**Login con `?next=` (panel).** Sin sesión, sesión inválida o 401 del API mandan a `/login?next=<ruta+parámetros>` (`urlLoginConDestino` en `frontend/lib/destino-login.ts`, usado por `session-context.tsx` y `session.ts`); tras iniciar sesión, `login/page.tsx` va a `destinoTrasLogin(...)`. `destinoSeguro` solo acepta `/dashboard` o rutas que cuelguen de él (`/dashboard/…`, `?` o `#`); rechaza URL absoluta, otro dominio, `//`, `\`, caracteres de control, porcentaje-codificaciones que escondan eso y cualquier otra sección (`/tienda`, `/mayoreo`…), y en esos casos se usa el destino por defecto (`/dashboard/pedidos` para Operador en menudeo, `/dashboard` en los demás). Cierre de sesión voluntario y entrada directa a `/login` no llevan `next`. Es lo que hace que el botón del WhatsApp (`dashboard/pedidos-b2b?pedido=<id>`) aterrice en el pedido tras iniciar sesión.

**Pruebas.** Suite de caracterización `backend/test/characterization/avisos-internos-pedido.char-spec.ts` (disparo, condiciones, fallos del webhook, 10 destinatarios con tope de concurrencia, privacidad del registro, callback, aislamiento entre negocios) y `notificaciones-whatsapp.char-spec.ts` (canal y evento por tipo de negocio, 409/403/400); `notificaciones-config-base.char-spec.ts` congela el contrato previo de `/notificaciones/canales` y `/eventos`. Unitarias: `aviso-pedido-modificado.spec.ts` y `notificacion-whatsapp.spec.ts`; frontend: `lib/destino-login.test.ts`, `lib/session-login.test.tsx` y `ajustes/notificaciones/notificaciones.test.tsx`. En `harness.ts`, `AvisoWebhookClient` se sustituye por un falso (`fakes.avisoWebhook`, recibe `{ url, secreto, cuerpo }`, por defecto resuelve `{ ok: true, status: 200 }`; ningún test hace fetch real). Como los avisos corren en segundo plano, **hay que llamar `h.esperarAvisos()` antes de leer `avisos_internos_envios` o de cualquier TRUNCATE** (la suite lo hace en cada limpieza y `close()` también espera los pendientes); si no, un aviso en vuelo escribe sobre una base ya truncada.

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
