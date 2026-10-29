# Hoteles y reservas (Amenitiz)

Negocios con `Tenant.tipoStorefront = HOTEL` y órdenes de tipo `RESERVA`. Caso real: Villas Ajijic (PMS Amenitiz). Un escenario de Make manda cada reserva a Aelika, que la guarda como `Order` (`tipo = RESERVA`) + `DetalleReserva` (1:1, tabla `detalles_reserva`) ligada a un `Cliente` (canal B2C, llave tenant + teléfono).

**Aelika es un espejo de solo lectura:** nunca modifica una reserva por su cuenta, y **guardar o actualizar una reserva no dispara ningún efecto** (ni Telegram, ni correo, ni Stripe). Las notificaciones sobre reservas las dispara el barrido horario con el trigger `RESERVA_AUTOMATICA` (ver [notificaciones.md](notificaciones.md)).

**Estado de despliegue:** el código y las migraciones (`20261023130000_hotel_enums`, `20261023130100_detalle_reserva`, `20261024120000_reserva_automatica_enums`, `20261024120100_regla_envio_log_order`) están en `main` desde el merge `44fe3dd` (2026-10-26). Que estén aplicados en producción y que Make esté enviando reservas: por confirmar con Santiago.

## Endpoint

`POST /internal/reservas/amenitiz` (`backend/src/reservas/`), `@Public()` + `BotAuthGuard` (`X-Api-Key` = `Tenant.botApiKey`, la misma del bot; `PrismaService` crudo). Una reserva por petición, con el objeto de `bookings/updated` de Amenitiz TAL CUAL (sin mapear en Make; campos desconocidos se ignoran; sin DTO, se valida en `reservas/amenitiz-reserva.ts`). Solo negocios `HOTEL` (otro tipo → 403; llave ausente/inválida → 401).

Respuesta `200 { resultado, ordenId, folio, cancelada }` con `resultado` = `creada | actualizada | sin_cambios | cancelada | reactivada | omitida_sin_telefono` (en la omitida los otros tres son `null`). Errores `400 { statusCode, error, codigo, message }` con `codigo` = `FORMATO_INVALIDO` (no es un objeto, p. ej. llegó un arreglo), `FALTA_ID` (`booking_id`), `ESTADO_DESCONOCIDO` (`status` distinto de `confirmed`/`modified`/`cancelled`), `FECHAS_INVALIDAS` (`checkin`/`checkout` no `YYYY-MM-DD`, o checkout ≤ checkin), `TOTAL_INVALIDO`. Make debe tener un manejador de errores para que la iteración continúe ante un 400.

## Mapeo

- `booking_id` (texto; puede pasar de 32 bits) = `pmsReservaId` y `Order.folio`; `pmsProveedor = 'AMENITIZ'`, único `(tenantId, pmsProveedor, pmsReservaId)` en la base (la ruta deja espacio a otros PMS).
- `status`: `confirmed`/`modified` = activa; `cancelled` = cancelada (`Order.cancelado`, `canceladoAt` = hora de recepción, Amenitiz no la manda).
- Huésped = `booker.first_name + last_name` ("Huésped" si viene vacío); correo solo si no está vacío (uno vacío nunca borra el guardado). `adults`/`children` del nivel superior → `adultos`/`ninos`.
- Habitaciones = texto `"Nombre #número"` separadas por coma, en el orden recibido. `source` → `origen` tal cual. `total_amount_after_tax` → `Order.total` (faltante/vacío = 0; no numérico = 400) y `currency_code` → `moneda`, sin conversión ni validación.
- Se guardan también `booker.language` (`idiomaHuesped`) y `online_checkin_url` (`onlineCheckinUrl`; token personal del huésped: **nunca va en logs ni respuestas**). No se guardan `online_checkin_registered`, ids de habitaciones ni noches (se derivan de check-in/out).
- **Pago:** `metodoPago = EXTERNO` y `estadoPago = PENDIENTE` (el cobro vive en el PMS y Aelika no lo registra; `PAGADO` haría que cualquier consulta que sume pagados sin filtrar por tipo la contara como ingreso). `estadoPedido` queda en el default (`PENDIENTE_CONFIRMACION`) y no significa nada para reservas.

## Idempotencia

Todo el procesamiento de UNA reserva corre bajo `pg_advisory_xact_lock(tenant:reserva:AMENITIZ:id)`; llamadas repetidas o simultáneas no duplican reserva ni cliente. No existe → crea; existe y cambió algo → `actualizada` (fechas, huéspedes, habitaciones, total, origen, moneda, idioma, enlace, contacto); sin cambios → no toca nada (ni `updatedAt`). Cancelada que no lo estaba → `cancelada`; cancelada que vuelve como `confirmed`/`modified` → `reactivada` (`cancelado = false`, `canceladoAt = null`, vuelve a contar). Si llega por primera vez ya cancelada se crea cancelada y sin contar (resultado `creada`, `cancelada: true`). Una `modified`/`cancelled` de un `booking_id` desconocido se crea.

## DECISIÓN: una reserva sin teléfono utilizable no se guarda

`omitida_sin_telefono` (200: caso esperado, no error). Motivo: hoy las reservas existen en Aelika solo para mandar notificaciones, toda orden requiere un Cliente y el Cliente se identifica por teléfono; no se permiten órdenes sin cliente ni clientes sin teléfono. Inutilizable = vacío, menos de 8 dígitos, más de 15, o todos los dígitos idénticos (placeholders de Expedia/Hotels.com como `+1 1111111111`).

**Consecuencia aceptada:** Aelika NO es un espejo completo del hotel (faltan sobre todo reservas de Expedia y Hotels.com, que ocultan el teléfono, y las `manual` sin teléfono). Si Aelika llega a dar métricas al hotel (ocupación, ingresos, recurrencia), esta decisión se revisa. Si la reserva YA existe y llega sin teléfono utilizable, el cambio se aplica por `booking_id` y se conserva TODO el contacto guardado; una rechazada que luego llegue con teléfono se crea en ese momento.

## Cliente y contadores

Alta/búsqueda con función propia (`clientes/cliente-reserva.ts`: `createMany … skipDuplicates` = `ON CONFLICT DO NOTHING`, así altas simultáneas no fallan; `FOR UPDATE` de los clientes en orden de id antes de escribir/recalcular); `sincronizarDesdePedido` no se tocó. Nombre/correo: el último escrito gana, pero solo al crear o cuando cambia el contacto (un reenvío sin cambios no pisa un nombre más reciente). Cambio de teléfono re-liga la reserva al otro Cliente y recalcula ambos. Un Cliente B2C cuenta además las `Order` `RESERVA` con `cancelado = false` (sin importar `estadoPago`); una cancelada no cuenta. Fechas de contadores = `createdAt` de la orden = hora de recepción (Amenitiz no manda fecha de reserva): un historial cargado de golpe queda con `ultimoPedidoAt` = día de la carga.

## Teléfonos internacionales

`common/telefono-internacional.ts`. **`normalizarTelefono` global NO cambió**: checkout B2C, portal B2B y Lealtad siguen truncando a 10 dígitos.
- México = 10 dígitos sin `+` (idéntico a hoy: `+52 …`, `+521 …`, `52…` de 12, `521…` de 13 y 10 dígitos). Cualquier otro país se guarda como `+` + código + número completo (`+18188140000`); el `+` evita que un internacional de 10 dígitos totales choque con un mexicano.
- Sin `+`: 11 dígitos que empiezan con 1 → `+1…`; 8–9 dígitos tal cual; otra longitud mayor a 10 → internacional. Prefijos `00`/`011` se tratan como `+`.
- **Limitación conocida:** un número de EE. UU. de 10 dígitos SIN código de país se confunde con uno mexicano (Amenitiz siempre manda `+`).
- **Envío a Botpress** (`ReglaEnvioService`, cualquier regla): `telefonoParaEnvio` antepone `+52` solo si el valor guardado no empieza con `+`. El OTP del portal B2B sigue con `+52` fijo (solo México). No se migraron clientes existentes.
- Pruebas: `backend/src/common/telefono-internacional.spec.ts`.

## Hotel en el resto del sistema

- `TenantB2cPublicGuard` rechaza `HOTEL` (404 como un slug inexistente); `TenantB2bPublicGuard` ya rechazaba todo lo no B2B. `GET /public/tenants/:slug` (info) no tiene guard: un hotel sigue devolviendo su info y `/tienda/<slug>` muestra el error del catálogo.
- `GET /internal/bot-config` de un hotel devuelve `catalogoUrl: null`.
- El panel no cambia (un hotel cae en la rama por defecto = menú y pantallas de menudeo). Las reservas no aparecen en Pedidos, Histórico, Kanban, Pagos, Dashboard ni exportes porque todas esas consultas filtran `tipo` B2C/B2B fijo; los huéspedes SÍ aparecen en el directorio de Clientes.
- `register` acepta `HOTEL` (opción en `/register`; no fija `giroNegocio`, que se elige aparte). `METODO_PAGO_LABEL` incluye `EXTERNO: 'Pago externo'`.
- Reglas automáticas sobre reservas (`RESERVA_AUTOMATICA`) y su editor en el panel: [notificaciones.md](notificaciones.md).
- Seed local de un hotel de prueba: `backend/prisma/seed-hotel-demo.ts` (ver [seeds-y-datos-demo.md](seeds-y-datos-demo.md)).
- Pruebas: `backend/test/characterization/reservas-amenitiz.char-spec.ts` (fixtures = respuestas reales de Amenitiz).
