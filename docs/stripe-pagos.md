# Stripe Connect, pagos con tarjeta y estado de pago

Cobros al cliente final (menudeo B2C). El modelo de negocio de Aelika es suscripción mensual, **sin comisión por pedido** (`application_fee_amount` no se usa); el cobro de esa suscripción a los negocios no está construido (no existe un modelo `Subscription`). El modelo `Payment` registra el cobro al cliente final. El pago de pedidos B2B es otra cosa: lo marca el equipo a mano (ver [diseno-operacion.md](diseno-operacion.md)).

## Cuenta Connect del negocio

SDK oficial `stripe@22.5.0`. Campos de `Tenant`: `stripeAccountId` (único), `stripeChargesEnabled`, `stripePayoutsEnabled`, `stripeContactEmail`.

- **Usa la Accounts API v2 (`stripe.v2.core.accounts`), no v1.** La cuenta de Stripe real del proyecto rechaza crear cuentas v1 ("Stripe no longer recommends Accounts v1 for new Connect integrations"), confirmado contra la API real. Si se reactiva v1 (flag en el Dashboard de Stripe), hay que revertir este cambio a propósito, no asumir que ambas rutas están disponibles.
- En v2 las capacidades están repartidas: `configuration.merchant.capabilities.card_payments` (cobrar al cliente) y `configuration.recipient.capabilities.stripe_balance.stripe_transfers` (recibir al balance de Stripe del tenant). `stripe_balance` **no** existe bajo `merchant`. El campo `payouts` no se solicita: se activa solo al satisfacer los requisitos de identidad/cuenta bancaria; se lee, no se pide.
- `configuration.recipient` exige `contact_email`: se usa `Tenant.stripeContactEmail` (400 si no está configurado).
- `defaults.responsibilities.fees_collector`/`losses_collector` (`'application_express'`/`'application'`) son el equivalente v2 de `controller.fees.payer`/`controller.losses.payments`: la plataforma (Aelika) paga las comisiones de Stripe y absorbe pérdidas, no el tenant.
- **Endpoints** (en `TenantController`, JWT + `@Roles(DUENO)`, sección "Cobros con tarjeta" de `/dashboard/ajustes/pagos`): `POST /tenant/me/stripe-account` (`TenantService.createOrContinueStripeAccount`) y `GET /tenant/me/stripe-status` (`getStripeStatus`). Si el tenant ya tiene `stripeAccountId` pero `stripeChargesEnabled`/`stripePayoutsEnabled` siguen en `false`, genera un `accountLink` nuevo para la misma cuenta (no da 409); solo da 409 si ambos ya son `true`. `InternalController` conserva `bot-config` y los redirects de onboarding (`GET /internal/stripe/onboarding-complete` / `onboarding-refresh`, sin guard: Stripe redirige ahí el navegador del tenant). No existe `InternalApiKeyGuard` ni `INTERNAL_API_KEY`.

## Webhook (`POST /webhooks/stripe`, `webhooks/stripe-webhook.controller.ts`)

- Intenta primero `stripe.webhooks.constructEventAsync` (eventos clásicos v1, ej. `payment_intent.*`) y si falla cae a `stripe.parseEventNotificationAsync` (eventos v2 "thin"). Misma verificación de firma (`stripe-signature` + HMAC); las variables son `STRIPE_WEBHOOK_SECRET` y `STRIPE_WEBHOOK_SECRET_V2`.
- Los eventos v2 llegan "thin" (`related_object.id`/`.type`/`.url`), así que el handler vuelve a pedir la cuenta (`accounts.retrieve(id, { include: [...] })`, mismo código que `getStripeStatus`) en vez de confiar en el payload.
- Escucha `v2.core.account[configuration.merchant].capability_status_updated` y el equivalente `recipient`, más `payment_intent.succeeded` / `.payment_failed` (clásicos); `payment_intent.processing` mueve a `PROCESANDO`. `payment_intent.canceled` y cualquier otro tipo se ignoran con 200.
- **Pruebas locales:** no registrar un Event Destination v2 permanente contra la cuenta real (quedaría huérfano apuntando a `localhost`). Usar `stripe listen --forward-to localhost:3001/webhooks/stripe --thin-events "<tipos>" --forward-thin-to localhost:3001/webhooks/stripe` (un solo `stripe listen` con ambos flags; `--forward-to` es necesario para reenviar también los clásicos). El `whsec_...` que imprime cambia cada vez que se vuelve a correr; hay que actualizar `STRIPE_WEBHOOK_SECRET` en el `.env`. **La CLI debe estar logueada (`stripe login`) en la MISMA cuenta que `STRIPE_SECRET_KEY`** (compara `stripe config --list` con el prefijo de la key); si no, los eventos nunca llegan. Se puede forzar con `stripe listen --api-key sk_test_...` o exportando `STRIPE_API_KEY`. Con un backend público real hay que crear el Event Destination permanente con `stripe.v2.core.eventDestinations.create(...)`.
- Colección de peticiones: `bruno/aelika-stripe/`.

## PaymentIntent (cobro real, `Order.metodoPago = TARJETA`)

Destination charge: el cargo se hace en la cuenta de Aelika y se transfiere a la cuenta conectada vía `transfer_data.destination`, sin `application_fee_amount`.

- `Order.estadoPago` (`EstadoPago`: `PENDIENTE`, `PROCESANDO`, `PAGADO`, `FALLIDO`, `REEMBOLSADO`) y `Order.stripePaymentIntentId` (único). `EFECTIVO` nace `PAGADO`; `TARJETA` nace `PENDIENTE` y solo el webhook lo mueve a `PAGADO`/`FALLIDO`/`PROCESANDO`. `TRANSFERENCIA` no está implementada (409).
- `PublicService.createOrder`: `TARJETA` da 409 si el tenant no tiene `stripeAccountId` + `stripeChargesEnabled` (mismo criterio que `aceptaTarjeta` en `GET /public/tenants/:slug`). El pedido se crea primero (folio asignado, `PENDIENTE`) y el `PaymentIntent` después, **fuera de la transacción del folio** (una llamada de red no debe sostener el advisory lock). La respuesta incluye `clientSecret` solo para `TARJETA`.
- Frontend: paso `pago-tarjeta` del checkout con `@stripe/react-stripe-js` (`Elements` + `PaymentElement`); `frontend/lib/stripe.ts` expone `getStripe()` memoizado. Requiere `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (no es derivable del `sk_test_...`; se copia del Dashboard).

### Checkout sin duplicados (huella)

Un solo pedido por intento de compra con tarjeta: "Atrás", cerrar y reabrir el pago y el doble clic no crean otro pedido ni otro PaymentIntent. Solo hacia adelante: los pedidos anteriores tienen `huellaCheckout = null` y nunca se reutilizan.

- **Huella** (`Order.huellaCheckout`, SHA-256, índice `(tenantId, huellaCheckout)`, `backend/src/common/huella-checkout.ts`): tenant + TARJETA, teléfono normalizado, nombre, correo, carrito canónico (líneas fusionadas y ordenadas, modificadores ordenados), entrega/punto/dirección, notas, factura y `total` recalculado — todo sobre valores ya resueltos por el servidor. `horaRecogida`/`horaRecogidaTipo` NO entran; al reutilizar se actualiza la hora solo en `DetalleB2C`. Prefijo de versión `v1`. Nunca sale en la API (`aRespuestaOrder` la quita).
- **Reutilización** (`PublicService.crearOReutilizarTarjeta`, después de todas las validaciones): bajo `pg_advisory_xact_lock(tenant:huella)` —antes del candado del folio, siempre en ese orden— se busca el pedido más reciente con esa huella dentro de **2 horas** del `createdAt` (elegibilidad, no expiración). `PENDIENTE`/`FALLIDO` → se valida el PaymentIntent en Stripe fuera de la transacción (estado `requires_payment_method`/`requires_confirmation`/`requires_action`, `amount` = total, destino = `stripeAccountId` actual); `PAGADO`/`REEMBOLSADO`, PaymentIntent cancelado/inexistente/con otro monto o destino, o fuera de ventana → pedido nuevo. Reutilizar NO llama a `nextFolio`, `sincronizarDesdePedido` ni al recálculo de contadores. EFECTIVO nunca se reutiliza.
- **PaymentIntent idempotente:** llave `pi-<orderId>`. `FALLIDO` sin PaymentIntent se reclama con un `updateMany` atómico (→ `PENDIENTE`); el ganador llama a Stripe con llave `pi-<orderId>-<uuid>`. `PENDIENTE` sin PaymentIntent espera (polling 250 ms / 3 s, `TIEMPOS_ESPERA_PI`) a que otro request lo guarde; solo si el pedido lleva >2 min sin tocarse (`PEDIDO_SIN_PI_ABANDONADO_MS`) se crea.
- **Errores:** fallo al crear el PaymentIntent → **503** "No pudimos iniciar el pago con tarjeta, intenta de nuevo" (pedido `FALLIDO`, reintento con el mismo folio). **409** "Tu pago anterior sigue procesándose" (pedido `PROCESANDO`, o PaymentIntent `processing`/`succeeded` con el pedido aún `PENDIENTE`); **409** "Reintenta en un momento" (el perdedor del reclamo no ve el PaymentIntent a tiempo).
- **Cobros huérfanos:** al crear un pedido nuevo se cancela en Stripe (best-effort) el PaymentIntent de los pedidos pendientes del mismo Cliente (mismo teléfono normalizado **y** mismo nombre normalizado) dentro de la ventana; el nombre evita cancelar el cobro de otra persona solo conociendo su teléfono.
- Tests: `backend/test/characterization/b2c-reutilizacion-tarjeta.char-spec.ts` y `backend/src/common/huella-checkout.spec.ts`. El Stripe falso del harness implementa `retrieve`/`cancel` y respeta la llave de idempotencia (`fakes.piStore`).

## Pedidos TARJETA no pagados: regla de producto

Un pedido cuenta cuando está pagado (`estadoPago = PAGADO`); un TARJETA en `PENDIENTE`/`PROCESANDO`/`FALLIDO` es un intento de pago, no un pedido (EFECTIVO nace `PAGADO`). La auditoría de producción mostró 31 de 142 pedidos de Entredós en ese caso, todos cobros abandonados o rechazados.

- **Estado de pago agrupado** (`backend/src/common/estado-pago.ts`, espejo en `frontend/app/dashboard/pedidos/estado.ts`): `PAGADO` → "Pagado"; `PENDIENTE`+`PROCESANDO`+`FALLIDO` → "Pago no completado"; `REEMBOLSADO` → "Reembolsado". Es la única vista que ve el negocio. Un solo mapeo para B2C, B2B y Pagos.
- **Panel e histórico:** ver pedidos-b2c.md (`soloPagados`, filtro `estadoPago`, CSV).
- **Métricas del Dashboard solo cuentan `PAGADO`:** `OrdersService.summary` / `summaryDaily` / `summaryPorEstatus` y `ClientesService.summaryDaily` (nuevos/recurrentes). **`REEMBOLSADO` queda fuera de pedidos e ingresos** (pero sigue visible en el panel activo con su badge, por eso las tarjetas por estatus del Dashboard pueden no coincidir con el Kanban).
- **Corte de día:** cada pedido cuenta en el día de su `createdAt`, no en el de su pago. "Hoy"/10 días los calcula el navegador (`frontend/lib/fecha.ts`).
- **Contadores de `Cliente`** derivados del estado de pago: ver modelo-datos.md.
- **Corrección de datos** de contadores: `backend/src/scripts/corregir-contadores.ts` (guía `backend/scripts/contadores/README.md`): DRY-RUN por defecto (transacción de solo lectura); `--aplicar` en una sola transacción con verificación por cliente y global (rollback si algo no coincide), idempotente; `--revert <archivo>` restaura los valores previos (incluido `updatedAt`) y se niega si un cliente cambió después, salvo `--forzar`. stdout es NDJSON (el respaldo que se guarda en un archivo local); stderr el resumen sin datos personales. Dentro de Railway exige `--proyecto-esperado`. Nunca se corre en staging/producción sin dry-run revisado.

## Reembolsos y Pagos

- `OrdersService.reembolsar` (Gerente/Dueño): `stripe.refunds.create`; `Order.stripeRefundId`; ningún webhook lo confirma (la respuesta de la API es la confirmación). Verifica el detalle B2C antes de tocar Stripe. Best-effort: el cliente pierde esa visita.
- Panel Pagos (`/dashboard/pagos`, `GET /payments` y `/payments/export`).

## Probado

Onboarding real de `envases-reynoso` y pedido `TARJETA` → `clientSecret` → confirmado con `pm_card_visa` → webhook → `estadoPago = PAGADO`. El bloqueo real de la prueba fue de configuración del entorno (los dos puntos de `stripe listen`), no de código. Las cuentas de Stripe de prueba creadas se dejaron tal cual (test, sin datos sensibles).
