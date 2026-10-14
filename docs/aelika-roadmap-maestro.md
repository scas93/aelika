# Aelika — Roadmap maestro: de "bot que cobra" a plataforma de ventas

## Documento de definición de producto (v7)

*Este documento se enfoca en decisiones de producto y estado del roadmap. El detalle técnico de lo ya implementado vive en `architecture.md` (referencia viva, actualizada por auditorías/resúmenes de ejecución). El paso a paso operativo de Meta/Botpress vive en `checklist-botpress-meta.md`. El detalle completo del Módulo 6 (Campañas) vive en el documento fuente `Aelika_Modulo_Campanas_Definicion_v2.docx`, aquí solo el resumen.*

---

## 1. Reencuadre estratégico

Aelika hoy resuelve la **ejecución de la venta** (bot atiende → storefront muestra → cobra → admin muestra resultados). Lo que se define en este documento **no es un módulo de generación de leads**. Es la capa que le da al negocio **orden, visibilidad y eficiencia sobre un proceso de ventas que ya existe**, pero que hoy vive disperso.

**Tesis:** Aelika ya está parado en el lugar más valioso del embudo — la conversación y la transacción — y hoy no explota esa posición para decirle al negocio qué está pasando con sus clientes.

**Aelika no es un CRM centrado en el cliente — es una plataforma centrada en la orden.** Venta corta y repetitiva, sin vendedor de por medio: la unidad de valor real es la orden (cuántas se generan, qué tan bien se despachan), no la relación de largo plazo con un cliente. Más parecido a una plataforma tipo Uber Eats/DoorDash para el comerciante que a un CRM tradicional — pantalla central = pedidos y su estatus de despacho; el cliente es una capa de identidad y mensajería de retención, no el objeto principal de trabajo diario.

**Qué NO es este roadmap (Módulos 1-5):** no es un CRM con pipeline de ventas gestionado por un equipo humano (sección 10); no es generación de leads nuevos (eso es el Módulo 6 — Campañas, aparte); no asume cambios de arquitectura sin auditoría previa.

---

## 2. Estado actual

| # | Módulo | Qué resuelve | Estado |
|---|---|---|---|
| 1 | **Clientes** | Directorio de clientes por tenant | ✅ Completo |
| 2 | **Órdenes** | Ciclo de vida ligado a Cliente + Kanban de despacho | ✅ Completo (B2C) — B2B pendiente. **En curso: centralización de órdenes (orden base + detalle por tipo), ver §4** |
| 3 | **Notificaciones** | Motor de reglas (Trigger + Filtro + Canal + Mensaje) | ✅ Completo — verificado en staging con WhatsApp real |
| 4 | **Dashboard mejorado** | Analítica cruzando 1-3 | Pendiente — se abarata con 1-3 ya completos |
| 5 | **Aelika Scan** | — | Pendiente de que Santiago lo defina |
| 6 | **Campañas de captación** | Generación de demanda — funnel de campañas, atribución, generación de contenido con AI | Definido (documento completo v2) — no iniciado técnicamente |

**Pendientes activos, sin bloqueo entre sí:**
- **Órdenes centralizadas (en curso)** — prerrequisito del tipo de orden Reserva (hotel, Villas Ajijic). Ver §4.
- Replicar la configuración de Notificaciones (Meta + Botpress) para Entredós y Banetto.
- Kanban B2B (Módulo 2) — se abarata después de la centralización.
- "List Templates desde Botpress" — traer estatus real de plantillas al panel (ver §5).
- Módulos 4, 5, 6, Ciclo de vida del lead (secciones 6-9).

Detalle técnico completo de lo implementado: `architecture.md` §5-15.

---

## 3. Módulo 1 — Clientes ✅

Directorio de clientes por tenant — quién es, cuánto ha comprado, cuándo fue su última compra. Base de identidad para los Módulos 2 y 3.

**Decisiones de producto:**
- `Cliente` representa a alguien que **ya compró al menos una vez** — se sincroniza en tiempo real desde `Order`/`PedidoB2b` (tras la centralización: desde `Order`, cualquier tipo), sin enriquecimiento manual.
- Canal `B2C`/`B2B` separado por diseño — un mismo teléfono en ambos canales del mismo tenant son Clientes distintos, sin fusionar.
- Cambio de número de teléfono = Cliente nuevo, sin fusión/deduplicación.
- Mecanismo de vinculación bot→storefront (teléfono en URL + banner de confirmación + reconfirmación en checkout) — diseñado, construcción pendiente como parte del Ciclo de vida del lead (sección 9).

---

## 4. Módulo 2 — Órdenes ✅ (B2C)

Ciclo de vida de la orden, ligado a `Cliente` vía FK.

**Decisiones de producto:**
- ~~`Order` y `PedidoB2b` se quedan separados~~ — **Revertida el 29-sep-2026.** Motivo: entra un tercer tipo de orden (Reserva de hotel, Villas Ajijic) y mantener tablas separadas obligaría a cada módulo transversal (Clientes, Notificaciones, Dashboard, Pagos) a aprender un caso más por tipo. Ver "Órdenes centralizadas" abajo.
- Pedidos + Histórico **no se unifican** — decisión tomada explícitamente.
- Kanban de despacho (no confundir con el pipeline de ventas de la sección 10) — implementado para B2C. B2B pendiente.

### Órdenes centralizadas (en curso, 29-sep-2026)

Una sola entidad `Order` con lo que comparten todos los tipos, más una tabla de detalle 1:1 por tipo. Regla: si un módulo transversal lo necesita para filtrar, notificar o sumar, va en la base; si solo lo usa la pantalla o la lógica de un tipo, va en su detalle.

- **Orden base (`Order`):** tenant, cliente, `tipo` (B2C / B2B / RESERVA), folio, contacto (nombre/teléfono/correo, unifica `clienteNombre`/`contactoNombre`), `estado`, `estadoPago`, `cancelado` + `canceladoAt`, `descuentoTotal`, `total`, `notas`, los 7 campos de factura, `metodoPago`, datos de Stripe, `canalOrigen`, fechas. La tabla `Payment` ya apunta a `Order`: todo lo de pagos queda centralizado.
- **DetalleB2C:** hora de recogida, método de entrega, punto de envío, dirección, `notasDescuento`. Se separa del todo (decisión: modelo limpio, no dejar campos B2C en la base).
- **DetalleB2B:** `negocioNombre`, `semanaInicio`, `modoCobro`, mínimo de piezas, `totalPiezas`, código de descuento, `subtotal`.
- **DetalleReserva:** hotel (ver doc "Órdenes centralizadas + Hoteles (Villas Ajijic)").
- **Productos:** una sola tabla `OrderItem` colgando de `Order` para todos los tipos (producto, nombre, precio, cantidad), con dos hijas opcionales: `OrderItemModifier` (solo B2C) y reparto por día (solo B2B, reemplaza `PedidoB2bItemDia`).
- **Estados:** una sola lista de valores + una definición por tipo (qué estados usa y cuál sigue) en un solo lugar del backend. B2C usa 4, B2B 3 (sin "Listo para entrega"), Reserva agrega Confirmada / En estancia / Finalizada en su etapa. Los estados configurables por tenant quedan **fuera** de este cambio (proyecto propio; reemplazará esa definición por tipo).
- **Estado de pago:** un solo enum (el de B2B es subconjunto del de B2C).
- **Cancelación:** bandera `cancelado` en la base (como hoy en B2B), no un estado.
- **`metodoPago`:** en la base; valores explícitos nuevos `EXTERNO` (reserva cobrada en Amenitiz) y `POR_DEFINIR` (B2B mientras no se capture), en vez de null.
- **Principio de ejecución:** cambia cómo se guarda, no el contrato de la API — el backend sigue devolviendo el mismo JSON plano, así el frontend (Kanban, comanda, impresora, checkout, panel B2B) no se toca.

**Etapas:**

| Etapa | Alcance | Riesgo | Estado |
|---|---|---|---|
| 0. Red de seguridad | Suite de caracterización por HTTP contra base `_test` (`backend/test/characterization/`, `npm run test:char`): 0a B2C, 0b B2B + transversal. 0c (datos B2B en staging) se hace justo antes de la etapa 2 | Nulo | ✅ 0a/0b cerradas (29-sep); suite en 353 tests tras Parte A (dato histórico; hoy la suite tiene 419); 0c ✅ (1-oct) |
| 1. Separar B2C | `DetalleB2C` (tabla `detalles_b2c`) + `Order.tipo` (`TipoOrden`, default B2C hasta 1b). Escritura doble (detalle + columnas viejas) y lectura con respaldo a columnas viejas hasta la 1b; todas las respuestas pasan por un solo mapeador (`orders/order-respuesta.ts`). Verificador en `backend/scripts/etapa1/` | El único con riesgo real (Entredós en producción) | ✅ En producción desde 29-sep (verificador TODO CORRECTO: 142 órdenes con detalle, 0 en traslape; revisión manual OK) |
| 1b. Contraer | Se hace en dos pasos. 1b-a: rellenar detalle faltante (idempotente), retirar escritura doble y lectura con respaldo (reversible con un deploy). 1b-b: borrar columnas viejas y el default de `tipo` (irreversible; respaldo manual antes, ver Infraestructura) | Bajo | Pendiente: falta correr el verificador de la Etapa 1 en producción (6-oct) |
| 2. Unificar B2B | `PedidoB2b` → `Order` (`tipo=B2B`) + `DetalleB2B`, productos a `OrderItem` (con entregas por día), validar tipo de orden vs `tipoStorefront` del tenant | Bajo (sin datos B2B reales en producción) | **En staging y validada (6-oct), aún no en producción.** Release A `2745a25`; migración de datos aplicada en staging (21 pedidos, 53 ítems, 98 entregas, 236 productos de entrega; auditoría OK, delta 0 en dos pasadas); Release B `51288c2`; corrección de `MIGRACION.md` (proyecto `aelika-staging`) `2bbd269`; `origin/staging` está en `2bbd269`. Probado a mano B2B y B2C en staging |
| 3. Reserva | Tipo RESERVA + sincronización Amenitiz | — | Pendiente |

**Infraestructura:** producción no tiene respaldos automáticos de base de datos (el plan de Railway no los incluye). Santiago acepta ese riesgo y saca un respaldo manual (`pg_dump`) antes de cualquier paso irreversible, como la 1b-b, que borra columnas. Redis ya actualizado (1-oct). Postgres sigue pendiente: aplicarlo en horario sin servicio y sin saltos de versión mayor. La CLI de Railway se enlaza por directorio: todo comando contra una base debe pasar proyecto/entorno explícitos.

**Regla de producto: qué cuenta como pedido (29-sep-2026).** Un pedido B2C cuenta cuando `estadoPago = PAGADO`. EFECTIVO y TRANSFERENCIA nacen pagados; un TARJETA en PENDIENTE / PROCESANDO / FALLIDO es un intento de pago, no un pedido. `REEMBOLSADO` no cuenta en métricas ni en `totalPedidos`, pero sigue visible en el panel activo con su badge. B2B cuenta si no está cancelado. `avanzar` no cambia (Entredós no usa el flujo de estados; el Kanban se deja como está). No se expiran pedidos abandonados por ahora.

**Corrección de pedidos TARJETA no pagados (Parte A) ✅ en producción desde 29-sep.** Auditoría: no se perdió ningún cobro (los 46 `succeeded` de Stripe estaban `PAGADO`); 31 pedidos TARJETA ($4,684) nunca se pagaron (29 abandonados, 2 fallidos).
- A1: panel activo, histórico, CSV (columna de estado de pago al final) y filtro por estado de pago con etiquetas "Pagado" / "Pago no completado" / "Reembolsado".
- A2: métricas del Dashboard y de clientes cuentan solo pedidos pagados. Los contadores de `Cliente` (`totalPedidos`, `primerPedidoAt`, `ultimoPedidoAt`) se recalculan con una sola función idempotente (`clientes/cliente-contadores.ts`) al pagar y al reembolsar. Sin pedidos contables: `totalPedidos = 0` y fechas = `Cliente.createdAt` (sin migración). El cliente se sigue creando al crear el pedido (FK obligatoria).
- A3: script `src/scripts/corregir-contadores.ts` (dry-run por defecto, `--aplicar`, `--revert <archivo>`). Producción: 82 clientes revisados, 54 cambiados (20 reales, 34 solo milisegundos), Σ `totalPedidos` 136 → 104 (−32), verificado, segundo dry-run sin cambios. Archivo de reversa en la máquina de Santiago: `~/aelika-correcciones/prod-contadores-aplicado-2026-09-29.ndjson` (conservar).
- Efecto visible: clientes con solo intentos sin pagar quedan en el directorio con 0 pedidos y salen de "activos", "nuevos" y Top clientes. Los números del panel y Dashboard de Entredós bajan respecto a lo que veían.

**Parte B1 ✅ en producción (6-oct-2026).** Duplicados del checkout con tarjeta: el servidor reconoce el mismo intento por una huella (`Order.huellaCheckout`, ventana de 2 horas), reutiliza pedido y PaymentIntent ("Atrás", cerrar y reabrir, doble clic), cancela el cobro huérfano si cambia el carrito (mismo teléfono y nombre) y responde 503 (no 500) cuando falla Stripe. Solo hacia adelante: los pedidos viejos no se tocan. `main` pasó de `f36e97e` a `3149900` por fast-forward (`ce7c2ce`, `c81d2e1`, `a9d7ea0`, `9009150`, `3149900`); migración `20261001120000_orders_huella_checkout` aplicada; prueba en producción sin pagar con "Atrás" y doble clic dejó un solo pedido. **B2 (retoques de la tienda: mostrar errores, botón deshabilitado en vuelo) queda opcional.**

**Decisiones B2B (1-oct-2026).** Los tests de caracterización afectados cambian a propósito, con su motivo declarado.

*Ya entró en la Etapa 2 (staging, Release B `51288c2`):*
- Validación del tipo de orden contra `Tenant.tipoStorefront`: los endpoints de pedidos B2B exigen un tenant `RETAIL_B2B` (panel 403, públicos 404); el CRUD de códigos de descuento y el checkout B2C quedan abiertos.
- Consolidación de productos repetidos: un mismo producto en dos ítems del carrito se guarda como un solo ítem, con las cantidades por día sumadas (totales y piezas no cambian).
- Entregas: cada fecha con producto es una `Entrega` real (Pendiente / Lista / Entregada / Cancelada) sobre la orden centralizada.
- Admin sin captura de factura: se queda así (no cambia).
- AL_FINAL despacha antes de cobrar: es el diseño, no un bug.
- Los cambios en `b2b-crear-publico.char-spec.ts:159` y `b2b-crear-admin.char-spec.ts:91` se deben al cambio de modelo (`PedidoB2b` → `Order` + `DetalleB2B` + `EntregaItem`) y a la consolidación de productos repetidos; **no** a las reglas de semana.

*Sigue pendiente — antes de lanzar Banetto, cambio aparte después de la Etapa 2:*
- Cancelar un pedido B2B: debe liberar el cupo del código de descuento y no contar en `totalPedidos` (igual que la regla de B2C). Hoy el cupo no se libera: `b2b-crear-publico.char-spec.ts:347` lo afirma.
- Semana del pedido: el flujo público acepta solo la `semanaDestino` (la siguiente; la ventana de Banetto es lunes 08:00 a viernes 18:00). El admin acepta solo la semana en curso o la semana destino; no se crean pedidos en el pasado. Por revisar al implementar: cómo se calcula la semana destino en tenants sin ventana de recepción. Los tests afectados se identificarán entonces.

*Mínimo de piezas:* el backend lo valida al confirmar, y el aviso en el storefront de mayoreo ya está implementado (`464a57f`: barra de progreso, "Mínimo alcanzado" y modal de instrucciones).

**Etapa 0c ✅ cerrada (1-oct-2026; ya en `staging` y en `main`).** Staging tiene datos B2B para validar la Etapa 2: 21 pedidos (9 originales + 12 sembrados) en `banetto-mayorista` (14) y `dominique-ansel` (7). Los originales son los folios #1 a #6, #13 y #14 de `banetto-mayorista` y el #1 de `dominique-ansel`. Los pedidos cubren variantes con `AL_FINAL` y `AL_INICIO`, códigos de descuento aplicados, `DESPACHADO`, `PAGADO` y cancelados. Todo lo sembrado lleva el marcador `[SEED-0c:…]` en `negocioNombre` y los códigos el prefijo `SEED0C_`. Script, auditoría y SQL de limpieza en `backend/scripts/etapa2/` (commits `ce7c2ce` y `c81d2e1`, ya en `staging` y en `main`; son scripts manuales, no corren al desplegar). Al cerrar la 0c, los 7 originales de entonces quedaron intactos por folio y total; los folios #13 y #14 de `banetto-mayorista` se crearon después, durante octubre. Las reglas de notificación activas se dispararon como se esperaba (7 envíos `EN_CURSO` a clientes ficticios). En el proyecto de staging el entorno se llama "production": identificar siempre por ID de proyecto, no por nombre de entorno.

**Pendientes de producto nuevos (6-oct-2026):**
- Los pedidos B2B sin confirmar de semanas pasadas siguen apareciendo como pendientes en el Inicio del panel B2B.
- El nombre del cliente se reemplaza con el último que se escribe con el mismo teléfono (`sincronizarDesdePedido`).
- Banetto tiene dos tenants en staging (`banetto` B2C y `banetto-mayorista` B2B): falta decidir cómo opera en producción.

**Otros hallazgos (aún abiertos):** alta en Lealtad deja `primerPedidoAt` = fecha de inscripción (el Dashboard cuenta "cliente nuevo" ese día); recibo de Telegram sin notas ni dirección.

**Hallazgo resuelto (6-oct-2026):** TARJETA que fallaba al crear el PaymentIntent respondía 500 e incrementaba `totalPedidos`. Con B1 responde 503 ("No pudimos iniciar el pago con tarjeta, intenta de nuevo"), el pedido queda `FALLIDO` y el reintento reutiliza el mismo folio; y desde la Parte A2 `totalPedidos` solo cuenta pedidos pagados, así que un intento fallido ya no lo incrementa.

**Fuera de este cambio (backlog aparte, hallazgos de la auditoría Fase 0):** `totalPedidos` no descuenta cancelados B2B (los no pagados B2C ya se corrigieron); cliente B2C duplicado en staging; `OrderItemModifier` no registrado en `TenantPrismaService`; respuesta pública de `createOrder` devuelve la fila cruda. Cada etapa cierra actualizando `CLAUDE.md` del repo (hoy desactualizado: no documenta `PedidoB2b`, `Cliente`, reglas ni Lealtad).

---

## 5. Módulo 3 — Notificaciones ✅

Motor de reglas de notificación (`Trigger + Filtro + Canal + Mensaje`), verificado de punta a punta con WhatsApp real en staging.

**Decisiones de producto:**
- Categorías = las dos de Meta (**Utility**/**Marketing**), sin capa propia encima.
- 4 tipos de Trigger: evento de pedido, estado de cliente (periódico), fecha programada, manual.
- Filtro = **query builder** real sobre campos de `Cliente`, combinable solo con Y — justificado porque quien arma las reglas es el equipo de Aelika, no el dueño del negocio.
- Candado de frecuencia: máximo 1 Marketing por cliente por semana (configurable por tenant), sin candado en Utility.
- Opt-in de Marketing: resuelto sin construcción nueva — todo `Cliente` elegible ya pasó por checkout, cubierto por los términos de servicio del negocio (confirmar que los incluyan, ver checklist).
- Mecanismo de envío: Aelika nunca toca credenciales de Meta — le habla a un webhook de Botpress (uno por tenant, cada uno con su propio bot/WABA), que a su vez le habla a Meta.
- Navegación: "Notificaciones" (nav anidada) con submódulos **Recontacto** (Marketing) y **Seguimiento** (Utility) — categoría fija según el submódulo de creación.
- Ajustes → "Conexión WhatsApp" consolida `botApiKey`, `botWebhookUrl`/`Secret`, y el candado configurable.

**Pendiente:** replicar para Entredós/Banetto (plantilla + Botpress + webhook, por tenant — nunca se comparte entre tenants); "List Templates desde Botpress" para traer estatus real de plantillas al panel, sin que Aelika toque credenciales de Meta.

Detalle técnico completo: `architecture.md` §9-15. Paso a paso operativo (Meta/Botpress, troubleshooting real): `checklist-botpress-meta.md`.

---

## 6. Módulo 4 — Dashboard mejorado (pendiente)

Evolución por etapas, cada una atada a cuándo su módulo de dependencia esté listo. Con 1-3 completos, la mayoría ya es barata de construir.

| Etapa | Depende de | Qué agrega |
|---|---|---|
| 0 — Hoy | — | Pedidos hoy, Ingresos hoy, Ticket promedio, Promociones activas, gráfica 10 días |
| 1 | Módulo 1 | Clientes nuevos/recurrentes, clientes activos, gráfica apilada, Top clientes |
| 2 | Módulo 2 | Números de clientes 100% confiables, resumen de pedidos por estatus |
| 3 | Módulo 3 | Recordatorios enviados, **clientes reactivados** (métrica clave — prueba real de valor), Promociones activas conectadas a reglas Marketing |
| 4 | Ciclo de vida del lead | Embudo agregado real, conteo de conversaciones |

---

## 7. Módulo 5 — Aelika Scan

Pendiente de definir. Santiago lo explicará en sesión futura.

---

## 8. Módulo 6 — Campañas de captación (definido, no implementado)

Documento fuente completo: `Aelika_Modulo_Campanas_Definicion_v2.docx`. A diferencia de los Módulos 1-4 (que dan orden/visibilidad a ventas ya existentes), este módulo sí es **generación de demanda** — conecta el esfuerzo de marketing con las ventas reales dentro de Aelika. Es lo que se venía descartando explícitamente del alcance de los Módulos 1-4 ("esto no es generación de leads, eso es Campañas, aparte").

**Objetivo y posicionamiento:** copiloto, no reemplazo de agencia — la AI sugiere (copy, estructura), el tenant o Aelika ejecutan y aprueban. Sin publicación autónoma. Target: cualquier negocio cuyo canal de captación sea digital (no física), sin importar vertical (restaurantes, hoteles, Airbnbs, etc.) — mismo mecanismo de adquisición transversal a todas las verticales que Aelika atienda.

**Funcionalidad v1:**
- Campañas con duración configurable (10/30/50 días).
- Sugerencias de contenido asistidas por AI, sobre contenido Listo/Parcial/Por generar.
- URL única de campaña (`pide.aelika.com/{slug-tienda}/{slug-campaña}`) — pieza central de atribución, se conserva de principio a fin de la sesión de compra.
- Monitoreo del funnel propio (clics → conversación → orden → ingresos atribuidos) — **incluido en v1**. Métricas de pauta (CPC, impresiones, gasto vía Marketing/Insights API) — **fuera de alcance v1**, requiere OAuth por tenant; para v1 basta un campo manual de presupuesto/gasto.
- Alertas: continuidad (al menos 1 campaña activa por tenant), vencimiento próximo sin sucesora, hitos del timeline.

**Atribución por canal de entrada:**
- Directa al storefront: la URL con slug ya lo resuelve, sin lógica adicional.
- Por WhatsApp: mensaje prellenado tipo "vengo de la campaña X" (riesgo: el cliente puede editarlo/borrarlo) — señal más confiable si Botpress expone el `referral`/click id estructurado de "clic a WhatsApp" en el webhook (**pendiente de confirmar**, ver preguntas abiertas). El bot solo construye el link con el slug correcto — el cierre del pedido siempre ocurre en el storefront, **no requiere ningún cambio en la lógica de creación de órdenes del bot**.

**Extensión v2 — generación de contenido con AI:**
- **Decisión de diseño central: motor de plantillas/composición, no generación de imagen tipo AI generativa** — evita mala renderización de texto y colores de marca imprecisos. La AI solo redacta el copy que entra en slots fijos de la plantilla; nunca genera ni modifica la imagen.
- **Brand Kit** por tenant (logo, 1-3 colores, tono) — el sitio web es autofill opcional, nunca dependencia (el segmento objetivo frecuentemente no tiene sitio web).
- Temática de campaña: texto libre, sin catálogo que Aelika mantenga.
- Librería v1: 3-4 plantillas fijas (con foto / sin foto / full-bleed), elegidas manualmente por el tenant — la AI no decide el layout.
- Una sola propuesta de copy + botón de regenerar. Aprobación manual obligatoria antes de "Lista" — sin publicación automática.

**Fuera de alcance v1:** creador de pautas dentro de Aelika, integración Marketing/Insights API, generación/publicación autónoma, programación automática (calendario recurrente), publicación directa a Instagram, contenido 100% sintético (avatares tipo HeyGen).

**Preguntas abiertas / dependencias externas:**
1. ¿Botpress expone el `referral`/click id del primer mensaje en el webhook? — determina si la atribución de WhatsApp es robusta o depende solo de texto prellenado.
2. ¿Quién produce las 3-4 plantillas iniciales? (Santiago, diseñador externo, herramienta interna).
3. ¿Qué proveedor de generación de texto/copy se usa?
4. ¿Cómo se almacena la pieza generada — imagen renderizada server-side, o composición client-side con datos estructurados? (afecta modelo de datos y costo de almacenamiento).

**Notas técnicas orientativas (no cerradas, punto de partida para auditoría):**
- `Campaign` cuelga de `Tenant` (mismo patrón multi-tenant existente) — duración en días, fechas, estado, slug único por tenant.
- `CampaignAsset` — estado de preparación + referencia a tarea de generación AI/plantilla usada.
- `CampaignClick` — ancla a sesión/carrito para que `campaignId` se propague hasta `Order`, mismo patrón que ya usa `tenantId` (y que ya usamos para `clienteId` en el Módulo 2).
- `BrandKit` cuelga de `Tenant`, con override puntual a nivel `Campaign`.
- `ContentTemplate` — catálogo server-side, no editable por el tenant en v1.
- Storefront: middleware que lee el segmento de campaña de la URL e inyecta en sesión/carrito.
- Alertas: job periódico (BullMQ) — **ya existe precedente de esto en el proyecto** (Módulo 3, Etapa 2b, `ReglaBarridoService` con `@Cron`), reutilizable como referencia de patrón.
- Monetario: `Decimal`, nunca `Float` (convención ya establecida en todo el proyecto).

---

## 9. Ciclo de vida del lead (transversal, fuera de alcance inmediato)

**Estado real: nada de esto está construido.** Diseño propuesto, no descripción de algo parcial. Distinto de `Cliente` (que solo existe post-compra) — cubre el recorrido *antes* de la primera compra.

**Entidad `Lead` propuesta** (separada de `Cliente`, no una extensión — `Cliente` ya tiene Módulos 1-2 dependiendo de que "existe = ya compró"):

| # | Estatus | Trigger |
|---|---|---|
| 1 | Conversó (crea el Lead) | Primer mensaje al bot — requiere Execute Code nuevo en Botpress, no existe hoy |
| 2 | Vio storefront | Link con identidad confirmada (mecanismo abajo) |
| 3 | Agregó al carrito | Instrumentación nueva del storefront |
| 4 | Checkout iniciado | Instrumentación nueva del storefront |
| 5 | Convertido (gradúa a Cliente) | `Order` exitoso (cualquier tipo) — esto ya existe (es el Módulo 1) |

No es estrictamente secuencial (se puede entrar directo en la etapa 2), y cada etapa alcanzada se registra con su propia fecha (no solo la actual).

**Resolución de identidad bot↔storefront — mecanismo ya definido:** teléfono como parámetro en la URL del link que manda Botpress + banner de confirmación ("¿tu teléfono es X? si no, cámbialo") + reconfirmación obligatoria en checkout. Resuelve también el riesgo de enlaces compartidos. Identificador = teléfono de WhatsApp, permanente, no efímero por sesión.

**Conexión con el Módulo 6:** la URL de campaña (`{slug-tienda}/{slug-campaña}`) y el link de identidad de este mecanismo son la misma pieza de infraestructura (URL que entra al storefront cargando contexto) — vale la pena diseñarlos juntos cuando se construya cualquiera de los dos, para no resolver el mismo problema dos veces.

**Tamaño real de este trabajo:** comparable a los Módulos 1+2 juntos. No bloquea nada ya construido — sí bloquea las reglas futuras de "lead que nunca compró" (carrito abandonado, etc.) y la atribución completa del funnel de Campañas.

---

## 10. Visión a futuro (fuera de alcance — no construir ahora)

**Kanban/pipeline de ventas por lead o venta individual.** Tiene sentido con equipo humano que mueva casos manualmente — hoy ningún tenant lo tiene. Anotado para verticales futuras con equipo de ventas (ej. inmobiliarias).

---

## 11. Roles y permisos

Sistema de roles ya en producción (`OPERADOR`/`GERENTE`/`DUENO`, `@Roles`+`RolesGuard`). No se construye ningún sistema de permisos granulares nuevo — se decide por módulo, usando el enum existente:

- **Clientes:** Dueño + Gerente. **Órdenes/Kanban:** todos los roles. **Notificaciones:** solo Dueño. **Dashboard:** Dueño + Gerente.

Patrón a replicar (tres piezas independientes): `@Roles(...)` backend, gate en `page.tsx`, filtro opcional en `getNavItems()`. Migrar a permisos granulares solo si aparece una necesidad real de subtipos de Operador — no por anticipado.

---

## 12. Cómo trabajamos (principios, no reglas de negocio)

- Auditoría de contexto solo cuando hace falta algo que las previas no cubrieron — no se audita todo de una vez.
- Cada módulo se parte en etapas; cada etapa es su propio prompt de implementación.
- Prompts de implementación citan **contexto técnico verificado** (archivo:línea de auditorías previas) en vez de re-describir lo ya confirmado — ver convención en el skill `aelika-development`.
- Prompts que definen modelo de datos nuevo sin precedente se mandan primero a revisión (Claude Code revisa el prompt, no lo ejecuta) antes de implementar.
- Toda decisión de producto y hallazgo de auditoría se refleja en este documento y/o en `architecture.md` en el mismo turno en que se confirma — no se deja para después.
