# Menudeo (B2C): catálogo, storefront, checkout y pedidos

Negocios con pedidos/pickup (pizzerías, cafeterías, panaderías). El cliente final pide en el storefront público `/tienda/[slug]` (el mapeo a `pide.aelika.com/{slug}` es un detalle de despliegue); el negocio opera en `/dashboard/pedidos`. Pago con tarjeta y reembolsos: [stripe-pagos.md](stripe-pagos.md). Modelo de datos: [modelo-datos.md](modelo-datos.md). Impresión del ticket: [impresion-hardware.md](impresion-hardware.md).

## Reglas que no se rompen

- **Nunca confiar en precios del cliente.** Un endpoint que recibe un carrito solo acepta `productId` + `cantidad` (+ `modifierOptionIds`); el servidor recalcula todo desde `Product.precio` y las promociones activas. El `ValidationPipe` global con `whitelist: true` descarta cualquier campo extra (`precio`, `total`).
- **El avance de estatus lo calcula siempre el servidor.** `PATCH /orders/:id/avanzar` nunca acepta un estatus del body; calcula el siguiente de la secuencia fija (409 si ya está `DESPACHADO`).
- **`GET`/`PATCH` de `/orders` están abiertos a los 3 roles** (a diferencia del Catálogo, donde la escritura es de Gerente/Dueño): el Operador necesita ver y avanzar pedidos. No agregar `@Roles(...)` ahí sin revisar la sección 1.4 del documento de planeación.
- **Un producto solo puede estar en una promoción activa a la vez** (409 al crear/editar, `PromotionsService`). Gracias a eso `PublicService.createOrder` aplica combos de forma greedy sin ambigüedad. Si se relaja la regla, hay que rediseñar ese cálculo.
- **Las escrituras con FK en el body validan que la FK pertenece al tenant** y devuelven 404 (no 403) si no.
- Un borrado con FK entrante devuelve 409 (ver modelo-datos.md). Borrar un `Product` referenciado en una promoción activa también da 409.

## Estatus de pedido B2C

Secuencial, un solo sentido, sin retroceso ni cancelación: `Pendiente de confirmación` → `Confirmado y surtiendo` → `Listo para entrega` → `Despachado`. **Esto aplica solo a B2C**; el ciclo de B2B (con cancelación y estados derivados de las entregas) está en [diseno-operacion.md](diseno-operacion.md).

## Catálogo y permisos

- CRUD de categorías y productos; la escritura es de Gerente/Dueño. Borrar categoría (`/dashboard/catalogo`, mismo permiso que "Desactivar") usa el `_count.products` que ya trae `GET /categories` para deshabilitar el botón sin una llamada extra; el 409 del backend sigue siendo la fuente de verdad si el conteo quedó desactualizado (el modal queda abierto y muestra el mensaje del servidor).
- `Product.erpId` editable en Catálogo (crear y editar; vacío = sin ID; 409 "Ya existe otro producto con ese ID del ERP").
- Subida de fotos de producto a R2 (`common/r2-storage.service.ts`).
- Gestión del equipo (`/dashboard/ajustes/equipo`): crear Operador/Gerente/Dueño con contraseña temporal (se muestra una sola vez; se comunica manualmente), cambiar rol o activo/inactivo con protección de "no dejar el tenant sin dueño activo"; `/auth/change-password` para reemplazar la temporal. Un Gerente no puede crear/ascender a Admin ni editar a un Admin (403).
- **Promociones** (tab dentro de `/dashboard/catalogo`): `Promotion.config` según `tipo` (`DESCUENTO_PRODUCTO` o `COMBO`), validado con DTOs por tipo.
- **Modificadores** (`modifier-groups/`): CRUD de `ModifierGroup` + `ModifierOption` (Gerente/Dueño escritura, `GET` a los 3 roles) y `POST`/`DELETE /modifier-groups/:id/products/:productId` para asignar/desasignar con `orden`. Al crear un grupo con `opciones` anidadas no se usa nested create (la extensión de tenant no inyecta `tenantId` en anidados): cada opción se crea con `modifierOption.createMany` después. UI del panel: `frontend/app/dashboard/catalogo/modifiers-section.tsx` y `catalogo/productos/[id]/page.tsx` (asignar grupos a un producto); el modal de producto del storefront es `frontend/app/tienda/[slug]/product-modifiers-modal.tsx`. (El `CLAUDE.md` anterior listaba esta UI como pendiente; ya existe en el código.)

## Storefront público (`/tienda/[slug]`)

- `PublicController` (`@Public()`) resuelve el tenant por slug con `PrismaService` crudo. `GET /public/tenants/:slug` (info, `abierto`, `facturacionModo`, `aceptaTarjeta`), `GET /public/tenants/:slug/catalog`, `GET /public/tenants/:slug/puntos-envio` (solo `activo: true`), `POST /public/tenants/:slug/orders`.
- `GET …/catalog` filtra `Category.activa` pero **no** `Product.disponible`: devuelve también los agotados con `disponible` en el JSON para mostrar el badge "Sin existencia". `createOrder` valida disponibilidad por su cuenta (query propia), así que no hay hueco en el checkout.
- **Diseño visual** ("vista embebida en WhatsApp", paleta "estilo Uber Eats"): acento negro/blanco (botón "+", subrayado de la tab activa, pill de cantidad, botón de carrito flotante y botones del checkout; el negro se invierte a blanco en modo oscuro con `dark:`) y rojo (`red-600`/`red-400` de Tailwind, sin token custom) exclusivo para descuentos (precio final + original tachado, badge "-{valor}% off"/"-${valor} off", líneas "Descuento" del resumen). Tokens custom en `frontend/app/globals.css` bajo `@theme inline`: `--color-whatsapp`, `--color-chat-bg`, `--color-chat-bg-dark`, `--color-chat-card-dark`, `--font-chat` (solo en el wrapper de `/tienda/[slug]`, no en el `body`). Nunca Tailwind arbitrario `bg-[#...]`. El botón "+" (círculo blanco, ícono negro) y `--color-whatsapp` no cambian: este último es la fuente del `focus:` verde de `.input`, clase compartida con el panel y con el buscador de `/tienda`. La barra de carrito es una pill flotante centrada (`fixed inset-x-0 … mx-auto w-fit rounded-full`).
- **Búsqueda client-side** (`page.tsx`): coincidencia parcial case-insensitive sobre `nombre`, aplicada a todos los productos de todas las categorías; los combos aparecen si algún producto que los compone coincide. Tabs de categoría horizontales + grid de 2 columnas.
- `CartItem`, `addToCart`, `changeQty`, `addCombo`, `precioConDescuento` (`page.tsx`) se mantienen con sus firmas. El resumen de pago del checkout calcula el descuento por producto client-side; el de combo solo se conoce al confirmar ("el precio de combos se ajusta al finalizar tu pedido").
- Las fotos son `<img>` planas (ver architecture.md). Si `fotoUrl` es `null` no se renderiza `<img>`.
- **Deuda conocida:** `frontend/lib/horario.ts` duplica la lógica de horario/margen de 15 min de `backend/src/common/horario.ts` (el frontend no puede importar del backend). Es solo UX; el servidor revalida. Si se ajusta en el backend, actualizar el frontend a mano.

## Checkout (`POST /public/tenants/:slug/orders`)

El cliente manda `clienteNombre`, `clienteTelefono`, `notas`, `horaRecogidaTipo`, `horaRecogida`, `metodoPago`, `metodoEntrega`, `puntoEnvioId`, datos de factura y `items: [{productId, cantidad, modifierOptionIds?}]`. El servidor, en este orden: negocio cerrado (409) → hora → `metodoPago` → `metodoEntrega`/punto de envío (404 si no pertenece al tenant o está inactivo) → facturación → cálculo de precio → `pedidoMinimo` → crea el pedido.

- **Cálculo:** combos primero (greedy), luego descuentos por producto sobre lo que sobra; snapshot de precio de lista por línea; `notasDescuento` legible. `total = subtotal + extra de modificadores − descuentoTotal`.
- **Los descuentos nunca aplican sobre el precio de los modificadores.** El extra (`Σ precioAdicional × cantidad`) se suma completo al subtotal antes de restar el descuento.
- **Modificadores:** cada línea acepta `modifierOptionIds`; `resolverModificadores` (con `PrismaService` + `tenantId` explícito, fuera de la transacción del folio) valida que cada opción pertenezca a un grupo asignado al producto (404), las reglas `obligatorio`/`tipoSeleccion` por grupo (400 con el grupo que falló) y que un grupo `UNICA` nunca reciba más de 1 opción. Cada `OrderItem` se crea iterando `dto.items` (una fila por línea del carrito); el cálculo de combos sigue usando el mapa deduplicado por `productId`.
- **Folio** autoincremental por tenant con advisory lock (ver modelo-datos.md).
- **Hora de recogida** (`RECOGER`): `LO_ANTES_POSIBLE` | `HORA_ESPECIFICA` ("HH:mm", mismo día, dentro del horario de hoy y al menos 15 min después de ahora); validado siempre en el servidor. Con `DOMICILIO` se fuerza `LO_ANTES_POSIBLE`/`null`.
- **Método de pago:** `EFECTIVO` (nace `PAGADO`) y `TARJETA` (ver stripe-pagos.md). `TRANSFERENCIA` existe en el enum pero el backend la rechaza con 409; en el storefront es un `<span>` sin manejador de evento, no una opción seleccionable.
- **Entrega a domicilio:** `PuntoEnvio` con `pedidoMinimo` opcional; el 409 dice cuánto falta (ej. `"El pedido mínimo para "Zona Centro" es $200.00 — te faltan $170.25"`). Requiere dirección del cliente (`direccionCalle/Numero/Colonia/Referencias`).
- **Facturación** (`Tenant.facturacionModo`): `DESACTIVADO` ignora los campos `factura*` (whitelist); `OBLIGATORIO` exige `requiereFactura: true` y todos los campos; `OPCIONAL` los exige solo si `requiereFactura: true`. **No hay IVA/impuestos.**
- `ClientesService.sincronizarDesdePedido` crea/resuelve el `Cliente` en la misma transacción.

### UI del checkout (`frontend/app/tienda/[slug]/checkout-modal.tsx`)

Pasos `cart` → `entrega` → `datos` → `pago` → `pago-tarjeta` (solo tarjeta) → `confirmation`; cada paso valida solo lo suyo (`canContinueEntrega` / `canContinueDatos` / `canSubmit`).
- `entrega`: toggle Recoger/Domicilio. Recoger reutiliza el selector de hora. Domicilio muestra un `<select>` de zona (`fetchPublicPuntosEnvio`) con su dirección y un aviso ámbar "Te faltan $X…" con Continuar deshabilitado si el total (ya con descuentos) no alcanza el mínimo. "A domicilio" se deshabilita si el negocio no tiene puntos de envío activos.
- `datos`: nombre, teléfono, notas.
- `pago`: resumen subtotal/descuento/total, método de pago y la sección de facturación según `facturacionModo` (oculta / checkbox "Quiero factura" / campos siempre visibles y requeridos).
- `confirmation`: bloque "Entrega" (el nombre de la zona se resuelve cruzando `order.puntoEnvioId` con la lista ya cargada, porque no hay snapshot) y, si aplica, bloque "Factura".

## Panel de pedidos (`/dashboard/pedidos`)

- Tabs "Activos" (`estadoPedido != DESPACHADO`, sin filtro de fecha; el backend no soporta "distinto de", así que se piden todos y se excluye `DESPACHADO` en el cliente) y "Entregados hoy" (`DESPACHADO` + `desde`/`hasta` de hoy); Kanban (`kanban.tsx`); cada card es expandible con el detalle inline (sin modal). Polling cada 25 s.
- `GET /orders?soloPagados=true` (el panel lo manda siempre): solo `PAGADO` + `REEMBOLSADO`. Un TARJETA que pasa a `PAGADO` por webhook aparece en el siguiente refresco. `REEMBOLSADO` sigue visible con su badge.
- Histórico (`/dashboard/pedidos/historico`, `GET /orders/historico` y `/historico/export`): muestra todos los pedidos con su estado de pago agrupado; filtro `estadoPago` (`PAGADO`/`NO_COMPLETADO`/`REEMBOLSADO`); el CSV agrega al final la columna "Estado de pago".
- `avanzar` sigue permitido sobre cualquier pedido y `findOne` no filtra; no hay expiración ni cancelación de intentos abandonados.
- Detalle: línea de entrega con `entregaLinea(order, nombrePuntoEnvio)` (exportada desde `lib/thermal-printer.ts` para que el ticket y el respaldo muestren el mismo texto; `"Recoger en tienda"` o `"Envío a domicilio · {nombre}"`); el nombre de la zona se resuelve con un mapa `id → nombre` de `fetchPuntosEnvio(token)` cargado una vez al montar. Sección "Datos fiscales" (solo si `requiereFactura`) en la card, el ticket ESC/POS y `ComandaImprimible`. `METODO_PAGO_LABEL` vive en `frontend/lib/api.ts`.
- **Nota conocida:** `fetchTenantSettings` (nombre del negocio al imprimir) pega a `GET /tenant/me`, que es solo Admin; con sesión de Operador/Gerente da 403 y el `.catch` lo traga, dejando el ticket sin nombre de negocio.

## Configuración del negocio (Ajustes)

- **Información del negocio** (`GET`/`PATCH /tenant/negocio`, Admin y Gerente; lista cerrada: giro, bienvenida, horario, ubicación). `/tenant/me` es solo Admin porque expone llave del bot, Stripe, facturación y mayoreo. `slug` y `nombre` no son editables. Reutiliza `HorarioSemanaDto`/`normalizarHorarioSemana` (los de `/auth/register`); el `HorarioEditor` vive en `frontend/components/`.
- **Facturación** (`facturacion-section.tsx`, `<select className="input">` con las 3 opciones, `PATCH /tenant/me`) y **Puntos de envío** (`puntos-envio-section.tsx`: CRUD con cards, edición inline, `ToggleSwitch` y modal de confirmación para `DELETE`; `GET /puntos-envio` a los 3 roles, escritura solo Admin; 409 si el punto tiene pedidos). Cada sección repite sus propias constantes `CARD`/`BTN_*`/`ToggleSwitch` (convención establecida, no una nueva).
- **Llave del bot** (`Tenant.botApiKey`, sección "Llave del bot"): se genera en `/auth/register`; `POST /tenant/me/regenerate-bot-key` (solo Admin) la reemplaza; `PATCH /tenant/me` nunca la expone. Ver [notificaciones.md](notificaciones.md) para `/internal/bot-config`.
- **Códigos de descuento** (módulo apagable `CODIGOS_DESCUENTO`).
