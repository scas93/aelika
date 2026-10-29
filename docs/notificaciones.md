# Notificaciones, motor de reglas, bot y avisos internos

Cuatro piezas que comparten infraestructura de envío:

1. **Canales y eventos de pedido** (`backend/src/notificaciones/`): Telegram, correo (Resend) y WhatsApp, con cola BullMQ (`notificaciones/queue/`) y proveedores en `notificaciones/providers/`. API: `/notificaciones/canales`, `/notificaciones/eventos`, `/notificaciones/telegram`. `NotificacionEvento` (`PEDIDO_RECIBIDO`, `PEDIDO_CONFIRMADO`, `PEDIDO_EN_CAMINO`, `PEDIDO_ENTREGADO`, `PAGO_CONFIRMADO`, `PEDIDO_MODIFICADO_CLIENTE`) con audiencia `CLIENTE` o `NEGOCIO`. El recibo de Telegram sale de la salida de `aRespuestaOrder`.
2. **Motor de reglas** (`backend/src/notificaciones-reglas/`): Trigger + Filtro + Canal + Mensaje, por WhatsApp vía Botpress. Panel: `/dashboard/notificaciones` (submódulos Seguimiento = categoría Utility y Recontacto = Marketing).
3. **Avisos internos** (`notificaciones/avisos-internos/`): avisos al equipo por WhatsApp (hoy un solo evento).
4. **Bot de Botpress** (`internal/`): config viva del negocio para el bot compartido.

**Estado de despliegue:** todo lo descrito está en `main` (último merge `533a119`, 2026-10-28). La plantilla de Meta de cada flujo y el workflow de Botpress se configuran fuera del repo: ver "Por confirmar" al final de este documento.

## Bot compartido y `/internal/bot-config`

Un solo bot en Botpress, compartido por todos los negocios (no un bot por tenant). Botpress identifica la cuenta receptora del mensaje y debe resolverla contra la API de Aelika para obtener el tenant. **Pendiente (no construido):** la API de resolución de tenant por canal (`CHANNEL_CONNECTION`: dado un canal y el ID de cuenta, qué negocio es). En Fase 1 esa vinculación se hace a mano en Botpress.

- `GET /internal/bot-config`: lo que Botpress consulta (`nombre`, `mensajeBienvenida`, `abierto`, `ubicacion`, `catalogoUrl`). Autenticación servidor-a-servidor propia, no JWT: `BotAuthGuard` (`backend/src/auth/guards/bot-auth.guard.ts`) lee `X-Api-Key`, busca el `Tenant` por `botApiKey` exacto y lo adjunta a `request.tenant` (401 si no hay match); el controlador es `@Public()` + `@UseGuards(BotAuthGuard)`. Patrón a seguir para toda integración server-to-server nueva (tipo de `request.tenant` en `backend/src/common/types/express.d.ts`).
- `catalogoUrl` = `${STOREFRONT_BASE_URL}/${tenant.slug}` (default `http://localhost:3000/tienda`); `null` en un hotel. El default de `mensajeBienvenida` está en `backend/src/common/mensaje-bienvenida.ts` (lo comparten `TenantService` y este endpoint).
- `Tenant.botApiKey` se genera al registrar el negocio (`generateApiKey()`); `POST /tenant/me/regenerate-bot-key` (solo Admin) la reemplaza.
- El bot solo saluda y responde horario/ubicación; el checkout vive en el storefront.

## Envío por WhatsApp

Todos los envíos (reglas, avisos internos, código del portal) hacen POST al webhook de Botpress del negocio (`Tenant.botWebhookUrl`, header `x-bp-secret` = `Tenant.botWebhookSecret`). Aelika no guarda ni usa el token de Meta. Todos los mensajes salen fuera de la ventana de 24 h, así que cada uno necesita una plantilla aprobada por Meta (categorías: marketing = recordatorios; utilidad = operativas; autenticación = código de acceso).

- **Tiempo límite (general, todas las reglas):** `AbortSignal.timeout(TIMEOUT_ENVIO_MS = 10 s)` en el `fetch` de `ReglaEnvioService.enviar`; si vence, el log queda `FALLO` (definitivo) y no se reintenta. Un POST que vence pudo haber llegado a Botpress, pero no se repite.
- **Teléfono:** `telefonoParaEnvio` antepone `+52` solo si el valor guardado no empieza con `+` (ver hoteles-reservas.md); `telefonoDestino()` da el número de notificación de un cliente (B2B: el principal).
- **Callback de reglas:** `/internal/reglas-envios` (mismo `BotAuthGuard`); registro en `ReglaEnvioLog` (`EN_CURSO` / `EXITO` / `FALLO`).
- **Crear o modificar un pedido B2B desde el portal NO dispara notificaciones** (decisión de diseño; un test lo verifica). El único evento B2B de reglas es Confirmado (`avanzar`, sin deduplicación; reconfirmar tras una modificación del cliente vuelve a enviarlo). Las reglas `PEDIDO_B2B/DESPACHADO` ya no disparan. No agregar avisos al equipo sin una decisión aparte (el aviso interno de abajo es la excepción aprobada).
- **Candado de Marketing** (`ReglaCandadoService`, `Tenant.candadoMarketingDias`): limita mensajes de categoría Marketing por cliente; **ignora las filas `FALLO`** (un mensaje que no llegó no consume el cupo).

## Triggers de reglas (`ReglaTriggerTipo`)

`EVENTO_PEDIDO`, `ESTADO_CLIENTE`, `FECHA_PROGRAMADA`, `MANUAL`, `RESERVA_AUTOMATICA`. Filtros: `ReglasFiltroService` (solo clientes del canal del negocio y nunca de baja). Plantillas con variables (`CAMPO_CLIENTE`, `CAMPO_PEDIDO`, `CAMPO_NEGOCIO`, `CAMPO_RESERVA`; catálogo en `plantilla-variable-catalogo.ts`). `FECHA_PROGRAMADA` (`disparadaEn`), `MANUAL`, `EVENTO_PEDIDO` y el filtro no se ven afectados por lo que sigue.

### `ESTADO_CLIENTE`: sin reenvío

El barrido horario (`ReglaBarridoService`) ya no manda la misma regla cada hora: un cliente la recibe UNA vez mientras siga cumpliendo el filtro. Estado en `ReglaClienteEstado` (`regla_cliente_estados`, única por regla+cliente; una fila = "cumple hoy"). En cada barrido se recalcula el conjunto:
- **sale** (ya no cumple) → se borra su fila; si vuelve a cumplir, recibe de nuevo.
- **sigue** → no se envía (cuenta en `omitidosYaEnviado` del resumen).
- **entra** → candado y envío; se registra si se intentó enviar.

Un envío en `FALLO` es definitivo (la fila queda; no se reintenta hasta que el cliente salga y vuelva a entrar); `EN_CURSO` sin callback cuenta como enviado. Si el candado de Marketing bloquea, o `enviar` lanza antes de poder intentar (tenant sin `botWebhookUrl`, cliente sin teléfono, variable inválida), NO se registra y se reevalúa en el siguiente barrido. Sin reinicio al reactivar la regla ni al cambiar filtro o plantilla (el barrido recalcula); sí se borra el estado si la regla cambia de `ESTADO_CLIENTE` a otro trigger (`ReglasService.update`).

**Llenado inicial:** la migración `20261023120000_regla_cliente_estado` enciende `Regla.estadoBasePendiente` en las reglas `ESTADO_CLIENTE` activas; su primer barrido solo registra a quienes ya cumplen, sin enviar, y apaga la marca (campo interno: la API lo omite). Una regla nueva, o activa que no existía al desplegar, envía a todos los que cumplen en su primer barrido. Pruebas: `backend/test/characterization/regla-barrido-estado-cliente.char-spec.ts`.

### `RESERVA_AUTOMATICA`: reglas sobre reservas de hotel

Solo negocios `HOTEL` (crear o editar una regla con este trigger en otro tipo de negocio → 400; el barrido también lo ignora si el tenant no es Hotel). Lo evalúa el MISMO barrido horario (`ReglaBarridoService.procesarReservas`), no una cola. Código: `reserva-trigger.ts` (lógica pura) y la rama del barrido. Migraciones `20261024120000_reserva_automatica_enums` y `20261024120100_regla_envio_log_order` (`ReglaEnvioLog.orderId`, FK `SET NULL`, índice `(reglaId, orderId)`).

- **Frecuencia** (`triggerConfig`): `{ frecuencia: 'CADA_HORA' }` en cada barrido; `{ frecuencia: 'DIARIA', hora: 0–23 }` en cada barrido desde esa hora hasta el fin del día, SIEMPRE en hora de CDMX (`Intl`, no la zona del servidor): una reserva que llega después de la hora todavía recibe el mensaje ese mismo día. Los "días" son de calendario CDMX (`hoyCdmx`). El `@Cron(EVERY_HOUR)` no cambió.
- **Filtro** (`filtro` JSON, condiciones unidas con Y, validado en `validarFiltroReserva`, NO por `ReglasFiltroService`): `DIAS_PARA_CHECKIN` (check-in − hoy; negativo si ya pasó, 0 = hoy), `DIAS_DESDE_CHECKOUT` (hoy − check-out; 0 = hoy, 1 = ayer) con `IGUAL | MAYOR_IGUAL | MENOR_IGUAL` y valor entero, e `IDIOMA_HUESPED` con `ES | NO_ES` (valor `ES | EN | DE`; sin idioma cuenta como ES). Al menos una condición de días (nunca se envía a todas las reservas). Siempre solo reservas no canceladas.
- **Un solo envío por regla y reserva:** se excluyen las reservas con CUALQUIER `ReglaEnvioLog` de esa regla (`EN_CURSO`, `EXITO` o `FALLO`); cancelar/reactivar no reenvía; una cancelada nunca recibe; una reactivada que nunca recibió sí. `FALLO` es definitivo. Un envío que lanza antes de intentarse o que el candado bloquea NO deja registro y se reevalúa mientras la reserva siga dentro de la ventana del filtro — en una regla diaria de un solo día, un bloqueo por candado puede perder el mensaje.
- **Sin llenado inicial sin enviar** (a diferencia de `ESTADO_CLIENTE`): al activar una regla, las reservas ya guardadas que cumplan el filtro reciben el mensaje en el primer barrido; "Reserva confirmada" (check-in ≥ 0) llegará a todas las reservas futuras ya cargadas — crear/activar las reglas antes de arrancar Make o aceptarlo.
- **Variables de reserva** (`CAMPO_RESERVA`, grupo `RESERVA`, solo en este trigger; `restriccion.tipo = 'reserva'`): `numeroReserva`, `checkIn`, `checkOut`, `noches`, `adultos`, `ninos`, `huespedes`, `habitaciones`, `enlaceCheckin`. Las fechas se formatean según el idioma de la PLANTILLA (`plantillaIdioma` que empieza con `es` → «25 de diciembre de 2026»; otro, incluido `de`, → «December 25, 2026»). Las variables de cliente y negocio siguen disponibles; las de pedido B2C/B2B se rechazan al guardar y, defensivamente, al enviar (`disponibleParaContexto`). **El enlace de check-in lleva un token personal: nunca se escribe en logs.**
- **Panel** (`/dashboard/notificaciones`, `regla-form.tsx`): en un negocio Hotel el selector de trigger ofrece «Reservas (automático)» (primero y por defecto) con frecuencia (cada hora / diario + hora CDMX) y un editor de condiciones; en los demás negocios el formulario no cambia (`useSession` ya trae `tenant.tipoStorefront`). No se verificó en un navegador real (solo `tsc`, eslint y vitest).
- Pruebas: `backend/test/characterization/regla-barrido-reservas.char-spec.ts` y `backend/src/notificaciones-reglas/reserva-trigger.spec.ts`.

## Avisos internos por WhatsApp (`notificaciones/avisos-internos/`)

Operativo en producción desde el 2026-10-29. El botón de la plantilla abre el pedido en el panel; para que aterrice ahí tras iniciar sesión ver el login con `?next=` en architecture.md.

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
- Migraciones: `20261028120000_notificacion_whatsapp_enums` (solo los dos `ALTER TYPE … ADD VALUE`, aislada porque un valor nuevo de enum no se puede usar en la misma transacción) y `20261028130000_avisos_internos_envios` (enum, tabla, 2 índices y 3 FK; aditiva). **Riesgo de reversa:** Postgres no permite quitar valores de un enum; revertir la primera exige recrear los tipos y fallaría si ya hay filas con `WHATSAPP` o `PEDIDO_MODIFICADO_CLIENTE`. Tratarla como irreversible en la práctica; la segunda sí se puede revertir con `DROP TABLE` + `DROP TYPE`. *(Deducción a partir del comportamiento de Postgres; el repo no documenta ni prueba ninguna reversa.)*

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

**Pruebas.** Suite de caracterización `backend/test/characterization/avisos-internos-pedido.char-spec.ts` (disparo, condiciones, fallos del webhook, 10 destinatarios con tope de concurrencia, privacidad del registro, callback, aislamiento entre negocios) y `notificaciones-whatsapp.char-spec.ts` (canal y evento por tipo de negocio, 409/403/400); `notificaciones-config-base.char-spec.ts` congela el contrato previo de `/notificaciones/canales` y `/eventos`. Unitarias: `aviso-pedido-modificado.spec.ts` y `notificacion-whatsapp.spec.ts`; frontend: `lib/destino-login.test.ts`, `lib/session-login.test.tsx` y `ajustes/notificaciones/notificaciones.test.tsx`. En `harness.ts`, `AvisoWebhookClient` se sustituye por un falso (`fakes.avisoWebhook`, recibe `{ url, secreto, cuerpo }`, por defecto resuelve `{ ok: true, status: 200 }`; ningún test hace fetch real). Como los avisos corren en segundo plano, **hay que llamar `h.esperarAvisos()` antes de leer `avisos_internos_envios` o de cualquier TRUNCATE** (la suite lo hace en cada limpieza y `close()` también espera los pendientes); si no, un aviso en vuelo escribe sobre una base ya truncada.

## Por confirmar (no verificable desde el repo)

- Que las plantillas de Meta de cada flujo (código de acceso `auth`, `pedido_modificado_cliente`, recordatorios, reservas) estén aprobadas y que los workflows de Botpress cumplan los contratos documentados aquí y en diseno-operacion.md.
- Que los eventos del módulo de Notificaciones estén replicados para Entredós y Banetto (pendiente según el roadmap).
