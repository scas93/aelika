# Modelo de datos

Fuente de verdad: `backend/prisma/schema.prisma` (34 modelos, 68 migraciones en `backend/prisma/migrations/`). Este documento agrupa los modelos por dominio y recoge los invariantes que el schema por sí solo no deja claros. El diseño funcional del módulo B2B está en [diseno-operacion.md](diseno-operacion.md).

## Mapa de modelos por dominio

| Dominio | Modelos |
|---|---|
| Negocio y usuarios | `Tenant`, `User` |
| Catálogo y entrega | `Category`, `Product`, `Promotion`, `PuntoEnvio`, `DiaSinEntrega` (festivos B2B), `ModifierGroup`, `ModifierOption`, `ProductModifierGroup` |
| Orden base y detalles | `Order`, `DetalleB2C`, `DetalleB2B`, `DetalleReserva`, `Entrega`, `EntregaItem`, `OrderItem`, `OrderItemModifier`, `Payment` |
| Pedidos B2B legados | `PedidoB2b`, `PedidoB2bItem`, `PedidoB2bItemDia`, `PedidoB2bCodigoDescuento` |
| Clientes | `Cliente`, `ClienteTelefono` |
| Lealtad | `LoyaltyCard`, `LoyaltyVisit`, `LoyaltyRedemption` |
| Notificaciones | `NotificacionCanalConfig`, `NotificacionEventoConfig`, `Regla`, `ReglaClienteEstado`, `ReglaEnvioLog`, `AvisoInternoEnvio` |
| Portal B2B | `SesionPortal` (no es tabla de tenant) |

Entidades planeadas que **aún no tienen modelo**: `CHANNEL_CONNECTION` (canal + `external_account_id` único, para resolver el tenant desde WhatsApp/Instagram/Facebook) y `SUBSCRIPTION` (lo que el negocio paga a Aelika). El documento de planeación tiene el ERD completo original (sección 4).

Enums clave: `Role` (`OPERADOR`, `GERENTE`, `DUENO`), `TipoStorefront` (`RETAIL_B2C`, `RETAIL_B2B`, `HOTEL`), `TipoOrden` (`B2C`, `B2B`, `RESERVA`), `EstadoPedido`, `EstadoPago` (`PENDIENTE`, `PROCESANDO`, `PAGADO`, `FALLIDO`, `REEMBOLSADO`), `MetodoPago` (`EFECTIVO`, `EXTERNO`, `TRANSFERENCIA`, `TARJETA`), `MetodoEntrega` (`RECOGER`, `DOMICILIO`), `FacturacionModo` (`OBLIGATORIO`, `OPCIONAL`, `DESACTIVADO`).

## Convenciones del schema

- Campos en **camelCase** (`tenantId`, no `tenant_id`).
- **Dinero siempre `Decimal`** (`@db.Decimal`), nunca `Float`.
- `id` de fila con `@default(uuid())`. Las **credenciales** (ej. `Tenant.botApiKey`, `LoyaltyCard.token`) usan `crypto.randomBytes(32).toString('hex')` (`backend/src/common/api-key.ts`), no UUID: un UUID identifica un registro, no es una credencial.
- **Many-to-many real (FKs + tabla de unión) solo cuando se necesita hacer join por la relación** (`Product` ↔ `ModifierGroup` vía `ProductModifierGroup`, para responder "¿qué grupos aplican a este producto?"). Si la relación nunca se consulta desde ese ángulo, un `Json` con el/los id(s) sigue siendo válido y más simple (`Promotion` referencia productos así; no migrarla sin una razón real de query).
- **Borrado con FK entrante:** se captura la violación (`P2003`) y se devuelve **409** con mensaje claro, no 500 (`Category`→`Product`, `PuntoEnvio`→pedidos, `ModifierGroup` asignado). Cuando hay snapshot (`OrderItem`, `OrderItemModifier`) la FK es `SetNull` y el borrado procede.
- **Folio autoincremental por tenant** nunca con `MAX(col)+1`: `pg_advisory_xact_lock(hashtext(tenantId))` dentro de la misma transacción que el insert (`PublicService.nextFolio`). Folio único por `(tenantId, tipo, folio)`: B2C y B2B llevan secuencias independientes (`nextFolio` filtra por tipo). El folio B2B nuevo es `P-` + 6 dígitos.
- **Horario:** `Tenant.horarioAtencion` es `Json` estructurado (una llave por día `lunes`…`domingo`, cada una `{ abierto, apertura: "HH:mm"|null, cierre: "HH:mm"|null }`; `backend/src/common/horario.ts`). "Abierto ahora" (`isAbiertoAhora`) usa `America/Mexico_City` fija vía `Intl.DateTimeFormat` con `timeZone` (IANA real por ICU), nunca aritmética manual de offset UTC.

## Tenant

Campos relevantes (ver comentarios en el schema): `slug` único, `tipoStorefront`, `giroNegocio` (solo segmentación interna, independiente del tipo de storefront), `modulosDesactivados`, `horarioAtencion`, `mensajeBienvenida` (sin default en la base: `null`/vacío se resuelve en `TenantService` con el default de `common/mensaje-bienvenida.ts`, nunca se guarda el default), `ubicacion`, `botApiKey`, `botWebhookUrl`/`botWebhookSecret` (webhook de Botpress), `facturacionModo`, `stripeAccountId` (único) / `stripeChargesEnabled` / `stripePayoutsEnabled` / `stripeContactEmail`, `modalidadesCobroB2b`, parámetros del portal B2B (`portalHoraEntrega`, `portalHorasAgregarDia`, `portalHorasModificar`, `portalHorizonteSemanas`, `numeroAtencion`, `portalPlantillaNombre`, `portalPlantillaIdioma`), ventana de recepción B2B (`pedidoB2bVentana*`), mínimo de piezas B2B (`pedidoB2bMinimoPiezas`, acepta 0 = sin mínimo; un negocio nuevo nace en 0) y `candadoMarketingDias` (candado de mensajes de Marketing, ver notificaciones.md).

- `Tenant.pedidoB2bModoCobro` está **DEPRECADO como fuente de verdad**: ya no se edita ni se expone; la columna se borrará después.
- `modalidadesCobroB2b` (Json, arreglo de `PedidoB2bModoCobro`; default `["AL_FINAL"]`, al menos una).

## Orden base + detalle por tipo

`Order` es la orden base (`tipo`: `B2C`, `B2B`, `RESERVA`; NOT NULL, `DEFAULT 'B2C'` hasta la Etapa 1b-b). Lo exclusivo de cada tipo vive en una tabla 1:1 (`orderId @unique`, `onDelete: Cascade`, lleva `tenantId` y está registrada en `TenantPrismaService`):

| Detalle | Tipo | Contenido |
|---|---|---|
| `DetalleB2C` (`detalles_b2c`) | B2C | `horaRecogidaTipo`, `horaRecogida`, `metodoEntrega`, `puntoEnvioId` (FK `Restrict`), `direccionCalle/Numero/Colonia/Referencias`, `notasDescuento` |
| `DetalleB2B` | B2B | `negocioNombre`, `semanaInicio`, `modoCobro`, `minimoPiezasAplicado`, `totalPiezas`, `subtotal`, código de descuento, `notaCliente`, `pagadoAt`, `confirmadoAt`, `origen`, `descuentoPorcentajeAplicado` |
| `DetalleReserva` (`detalles_reserva`) | RESERVA | datos de la reserva del PMS (ver [hoteles-reservas.md](hoteles-reservas.md)) |

Casing: el MODELO es `DetalleB2C` (`prisma.detalleB2C`) y la RELACIÓN en `Order` es `detalleB2c`.

**Contrato de API:** las respuestas de pedido B2C siguen siendo el JSON plano de siempre (campos B2C en la raíz, sin `tipo` ni `detalleB2c`). Toda respuesta y salida interna (recibo de Telegram, contexto de reglas) convierte orden + detalle con `aRespuestaOrder` (`backend/src/orders/order-respuesta.ts`); nunca se devuelve una fila de `Order` cruda. La suite de caracterización (`npm run test:char`) congela ese contrato.

**Estado de la Etapa 1b-a (hecha, en `main`):** `createOrder` escribe y lee los campos B2C únicamente en `DetalleB2C`. Las columnas viejas de `Order` siguen en el schema marcadas `DEPRECADO` y **no se leen ni se escriben**: `horaRecogidaTipo`, `horaRecogida`, `metodoEntrega`, `puntoEnvioId`, `direccionCalle/Numero/Colonia/Referencias` y `notasDescuento`; también la relación inversa `PuntoEnvio.orders`. **No las quites del schema antes de la 1b-b** o `migrate dev` genera un `DROP COLUMN`.
- **Dato falso conocido y aceptado:** en una orden nueva a domicilio, `Order.metodoEntrega` queda en el default `RECOGER` (y `horaRecogidaTipo` en `LO_ANTES_POSIBLE`); nada lo lee.
- Una orden B2C sin detalle es una inconsistencia de datos, nunca se inventan valores: `exigirDetalleB2C` registra el id y lanza 500 en lecturas individuales; `aRespuestaOrdenes` la omite (con log de error) en listas; `avanzar` y `reembolsar` la verifican ANTES de cambiar el estatus o tocar Stripe; el recibo de Telegram no se encola.
- El verificador de la Etapa 1 (`backend/scripts/etapa1/`) acepta `--hasta <fecha ISO>` (instante del despliegue de la 1b-a) para que la comparación detalle ↔ columnas viejas solo cubra órdenes anteriores.
- **Pendiente — Etapa 1b-b:** borrar las columnas viejas de `Order`, la relación inversa `PuntoEnvio.orders` y el `DEFAULT` de `tipo` (migración irreversible; sacar un respaldo manual antes).

### Campos de `Order` que conviene recordar

- `metodoPago` es **nullable** (B2B no tiene; una CHECK en la base impide null en B2C — Prisma no la modela). `metodoEntrega` es un enum aparte de `metodoPago` (antes un solo enum mezclaba ambos).
- `estadoPago` tiene `@default(PAGADO)` (herencia del pago en efectivo B2C). `crearOrdenB2b` es el ÚNICO lugar que crea una orden B2B y fija `PENDIENTE` explícito; no crear órdenes B2B por otro camino.
- `cancelado` / `canceladoAt` son del módulo B2B (flag ortogonal a `estadoPedido`; B2C no cancela y su API no los expone).
- `modificadoPorClienteAt`: marca "Modificado por el cliente" (B2B).
- `huellaCheckout` + `stripePaymentIntentId` (único) + `stripeRefundId`: pago con tarjeta (ver [stripe-pagos.md](stripe-pagos.md)).
- `Order.estadoPedido` guarda también `EN_PROCESO` y `COMPLETADO` (calculados) en B2B. `EstadoPedido` es compartido con B2C: todo lo B2C que lista o valida sus valores usa `ESTADOS_B2C` (`backend/src/orders/estados-b2c.ts`), nunca `Object.values(EstadoPedido)`.
- Facturación: `requiereFactura` + `facturaRazonSocial`, `facturaRfc`, `facturaRegimenFiscal`, `facturaUsoCfdi`, `facturaCodigoPostal`, `facturaCorreo`. **No hay IVA/impuestos**: el total es `subtotal + extra de modificadores − descuento`.

## Orden B2B (Etapa 2)

Un pedido B2B es `Order` (`tipo = B2B`) + `DetalleB2B` + `OrderItem` (`cantidad` = suma de sus entregas; `orden` = posición, solo B2B) + `Entrega` + `EntregaItem` (único por entrega+ítem).

- `Entrega`: `fecha` real, `estado` (`PENDIENTE`/`LISTA`/`ENTREGADA`/`NO_RECOGIDA`/`CANCELADA`), `nota`, `hora?`, `destino?`, `estadoCambiadoAt`; `estadoCambiadoPorId` sigue en el schema sin uso.
- **Sin restricción única `(orderId, fecha)` en la base a propósito** (otros tipos de orden podrán tener varias entregas el mismo día); "una por fecha" es regla de la lógica B2B (`pedidos-b2b-orden.ts`, edición bajo `FOR UPDATE` de la orden).
- `PedidoB2b` y sus tablas **no se borran** todavía: dejan de escribirse y se retirarán en una etapa posterior. `Cliente.pedidosB2b` es la relación legada; las consultas nuevas leen `Order`.
- Toda consulta B2C a `Order` filtra `tipo = B2C` (panel, histórico, métricas, `avanzar`, `reembolsar`, contadores, folio); un pedido B2B nunca aparece ni se puede operar desde los endpoints B2C.

## Catálogo, modificadores y promociones

- `ModifierGroup` (`tipoSeleccion` `UNICA`/`MULTIPLE`, `obligatorio`) con `ModifierOption`; asignables a varios productos vía `ProductModifierGroup` (con `orden`). `ModifierOption.tenantId` está denormalizado desde `modifierGroup.tenantId` para registrarlo en `TenantPrismaService`; `ProductModifierGroup` no lleva `tenantId` ni está registrada ahí (ambos lados se validan contra el tenant antes de tocarla). `ProductModifierGroup.modifierGroup` es `Restrict`; `.product` es `Cascade`.
- `OrderItemModifier`: snapshot de nombre/precio adicional (FK `SetNull`). `OrderItem` guarda snapshot de nombre/precio; una fila por línea del carrito, no por producto distinto.
- `Promotion.config` (`Json`, shape según `tipo`: `DESCUENTO_PRODUCTO` | `COMBO`) validado en la capa de aplicación con DTOs por tipo, no por Prisma/Postgres.
- `PuntoEnvio`: zona de envío simple (`nombre`, `direccion`, `pedidoMinimo?`, `activo`); **no es un modelo de sucursales** (sin catálogo/horario/inventario propio). Sin snapshot de nombre/dirección en la orden, de ahí el `Restrict`.
- `Product.erpId` (único por negocio, opcional).

## Clientes

- `Cliente`: llave tenant + teléfono en el canal B2C; `canal` `B2C` | `B2B`. Un mismo teléfono en ambos canales del mismo tenant son Clientes distintos, sin fusionar; cambio de teléfono = Cliente nuevo.
- **B2B** (dado de alta por un admin, `clientes/cliente-b2b.ts`): `codigo` (`{slug}-{sufijo}`, único por negocio, no editable, **interno**: se usa en el Excel y en seeds/scripts, no se muestra en el panel), `direccion`, `descuentoPorcentaje`, `modalidadPago` (obligatoria en todo alta/edición), `bajaAt`, `favoritoB2b` (Json, un favorito por cliente), `ultimoAccesoAt`. **`Cliente.telefono` es nullable**: en B2B queda null y sus teléfonos viven en `ClienteTelefono` (un número puede estar en varios clientes; un solo principal por cliente, índice parcial en SQL). `telefonoDestino()` da el número de notificación (B2C: el propio; B2B: el principal).
- CHECK `clientes_identidad_check` (B2C ⇒ teléfono, B2B ⇒ código), `NOT VALID` en la migración para no fallar con datos viejos; se valida al limpiarlos.
- **Contadores derivados** (`totalPedidos`, `primerPedidoAt`, `ultimoPedidoAt`): nunca incrementos sueltos; los fija `recalcularContadoresCliente` (`backend/src/clientes/cliente-contadores.ts`) a partir de los pedidos contables:
  - B2C: `Order` con `estadoPago = PAGADO` (y las `RESERVA` con `cancelado = false`, sin importar `estadoPago`).
  - B2B: `Order` con `cancelado = false` (sin importar `estadoPago`).
  - Fechas = `createdAt` del pedido. **Sin pedidos contables: `totalPedidos = 0` y ambas fechas = `createdAt` del Cliente** (las columnas son NOT NULL).
  - `sincronizarDesdePedido` no toca contadores: crea el Cliente con `totalPedidos = 0` o solo actualiza `nombre`/`correo` (también en intentos no pagados). La FK `Order.clienteId` obliga a crear el Cliente antes que el pedido; el recálculo va después, en la misma transacción.
  - Ganchos (idempotentes; aceptan cliente Prisma raíz, transacción o de tenant): al crear un pedido que ya cuenta, en el webhook al pasar a `PAGADO` (best-effort), al reembolsar (best-effort), y en B2B al cancelar y en `marcarPagado`. Dos recálculos exactamente simultáneos podrían pisarse; el siguiente recálculo o el script de corrección lo repara.
  - `GET /clientes/activos` exige `totalPedidos > 0`; Top clientes usa `GET /clientes?conPedidos=true`. `GET /clientes` omite los campos B2B (`OMITIR_CAMPOS_B2B`) para no cambiar su contrato.
- `DetalleB2B.confirmadoAt` y `Cliente.ultimoAccesoAt` son datos base de observabilidad (ver diseno-operacion.md); no salen en ninguna respuesta de API.

## Notificaciones y portal

`Regla`, `ReglaClienteEstado`, `ReglaEnvioLog` (con `orderId` opcional, FK `SET NULL`), `NotificacionCanalConfig`, `NotificacionEventoConfig`, `AvisoInternoEnvio`: ver [notificaciones.md](notificaciones.md). `SesionPortal`: token opaco guardado como hash; ver diseno-operacion.md.

## Lealtad

`LoyaltyCard` (1:1 con `Cliente`, `token` único como credencial), `LoyaltyVisit`, `LoyaltyRedemption`: ver [lealtad.md](lealtad.md).
