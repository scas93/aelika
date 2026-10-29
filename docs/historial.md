# Historial de fases y progreso

> **Documento histórico.** Es la bitácora de cómo se construyó Aelika, movida desde el `CLAUDE.md` anterior. **No contiene instrucciones vigentes**: el comportamiento actual de cada área vive en su documento (ver el mapa en `CLAUDE.md`). Si algo de aquí contradice a esos documentos o al código, mandan ellos.

## Fases originales del plan

El plan de 4 fases viene de `Aelika - Documento de Planeacion.md`. Qué pasó con cada cosa que la "Fase 1" original marcaba como "no construir todavía":

| Item planeado | Fase original | Situación verificada en el repo |
|---|---|---|
| Configurador de bot en el panel (autoservicio) | 2 | No construido |
| Vinculación OAuth de canales (Embedded Signup de Meta) | 2 | No construido; los canales se conectan a mano en Meta Business Manager/Botpress |
| Pago en línea con Stripe para clientes finales | 3 | **Construido** (Stripe Connect + PaymentIntent): [stripe-pagos.md](stripe-pagos.md) |
| Dashboard de métricas | 3 | Existe un Dashboard básico (`OrdersService.summary*`, `/dashboard`); el «Dashboard mejorado» sigue pendiente según el roadmap |
| Suscripción/billing de Aelika a los negocios | 4 | No construido (no hay modelo `Subscription`) |
| Impresión térmica automática (red/CloudPRNT) | 4 | No construido; la impresión es manual por WebUSB: [impresion-hardware.md](impresion-hardware.md) |
| Proveedor de email | 2 | Existe Resend para notificaciones (`notificaciones/providers/correo.provider.ts`); sigue sin haber recuperación de contraseña por correo |

Lo que la Fase 1 sí incluía y se completó: backend multi-tenant (NestJS + Prisma + Postgres), panel administrativo (catálogo, pedidos, impresión), catálogo web público con carrito y checkout, API para el bot, autenticación con roles.

## Fase 0 — infra y onboarding (completa)

Monorepo (`backend` NestJS + Prisma, `frontend` Next.js), Docker Compose (Postgres + Redis), autenticación JWT con aislamiento multi-tenant, registro/login. Primer commit: 2026-08-19.

## Fase 1 — MVP con piloto manual: progreso original

Orden aproximado en que se completó cada pieza (el detalle vigente está en los documentos de área):

1. **Catálogo** (CRUD de categorías y productos, permisos por rol; borrar categoría usa `_count.products`; verificado forzando el 409 por conteo desactualizado).
2. **Gestión de usuarios del negocio** (`/dashboard/ajustes/equipo`).
3. **Promociones** (`DESCUENTO_PRODUCTO` / `COMBO`).
4. **Catálogo web público** (`/tienda/[slug]`, `PublicController`).
5. **Rediseño visual del storefront** ("vista embebida en WhatsApp", acento verde `#25D366`), luego **segunda pasada de paleta "estilo Uber Eats"** (negro/blanco + rojo para descuentos). En esa pasada se verificó visualmente que el negro plano no tiene contraste contra `#0B141A`/`#1F2C34` y por eso se invierte con `dark:`.
6. **Checkout real** (`POST /public/tenants/:slug/orders`; folio con advisory lock verificado sin colisiones bajo pedidos concurrentes reales; verificado con un pedido real de punta a punta —combo + producto con descuento— que el total/descuento coincide con el cálculo previo al rediseño y aparece igual en `/dashboard/pedidos`).
7. **Hora de recogida** y método de pago (`AL_RECOGER`/`PAGO_EN_LINEA` al inicio).
8. **Módulo de pedidos en el panel** (tabs, Kanban, polling de 25 s).
9. **Impresión de comanda vía WebUSB.**
10. **Rediseño visual del panel admin** (mockup de Claude Design; sidebar de 210 px + topbar).
11. **Configuración del negocio** (`mensajeBienvenida`, `horarioAtencion`, `ubicacion`) y **llave del bot** + `GET /internal/bot-config`.
12. **Facturación configurable + envío a domicilio** (backend → UI de administración → rediseño del checkout → detalle de pedido y ticket). `MetodoPago` pasó de `AL_RECOGER`/`PAGO_EN_LINEA` a `EFECTIVO`/`TRANSFERENCIA`/`TARJETA` con una migración a mano (`20260819183000_facturacion_envio_metodopago`): todo pedido existente se convirtió a `EFECTIVO` (todos se pagaron en persona al recoger).
13. **Modificadores de producto** (solo backend al principio; la UI llegó después).
14. **Stripe Connect** (creación de cuenta, estado, webhook) y **PaymentIntent** (cobro real con tarjeta).
15. **Pedidos TARJETA no pagados** (Partes A1, A2, A3 y B1).

## Verificaciones históricas relevantes

- **Facturación + envío:** probado en el navegador de punta a punta con datos reales creados/borrados solo para la prueba: Recoger con "Elegir hora", Domicilio por debajo y por encima del mínimo, facturación `OPCIONAL` sin marcar y marcada, y `OBLIGATORIO`. Confirmado que Transferencia/Tarjeta eran `<span>` sin manejador de evento. Dos pedidos reales (Recoger sin factura; Domicilio con factura completa) verificados en la card expandida y en `#comanda-imprimible`, y borrados después. El ticket WebUSB nunca se probó contra una impresora física.
- **Modificadores:** probado contra el backend real (`pizzeria-demo`): grupo "Tamaño" (`UNICA`, `obligatorio`) con "Chica"/"Grande" (+$30) asignado a "Pizza Hawaiana" — "Grande" x2 dio `total = 359` ($149.5×2 + $30×2); sin selección 400, dos opciones del mismo grupo 400, `modifierOptionId` inexistente 404; producto sin grupos sin regresión; combo activo (Hawaiana+Pepperoni por $220) + "Grande" en la Hawaiana dio `total = 250` ($279.4 − $59.4 de combo + $30), confirmando que el descuento no toca el modificador; `DELETE` de un grupo asignado 409, tras desasignar 200.
- **Stripe Connect:** probado contra la cuenta de test real: creación de cuenta (URL de onboarding real), 409 al repetir, consulta de estado, webhook con firma real (`Stripe.webhooks.generateTestHeaderString`) simulando `v2.core.account[configuration.merchant].capability_status_updated`. Al mover el endpoint a `TenantController` se repitió: `sin_cuenta` → crea + url; sin `stripeContactEmail` → 400; cuenta incompleta → nueva url con el **mismo** `stripeAccountId`; conectada → 409.
- **Panel de configuración (UI de facturación y puntos de envío):** el modo de facturación persiste tras recargar; CRUD completo de un punto de envío verificado contra el backend real, con limpieza posterior (`facturacionModo` de vuelta a `DESACTIVADO` en los 4 tenants, tabla `puntos_envio` vacía).
- **Catálogo con Banetto/Reynoso:** verificado en el navegador el catálogo completo de Reynoso y el aviso ámbar de "te faltan $X".

## Cronología del módulo B2B (para contexto)

- **Etapa 0** (caracterización): suite `backend/test/characterization/` (11 áreas B2C + bloqueo de red saliente).
- **Etapa 1 / 1b-a:** `DetalleB2C`; `exigirDetalleB2C`; el verificador `backend/scripts/etapa1/`. La 1b-b (borrar columnas viejas) sigue pendiente.
- **Etapa 2:** B2B sobre `Order`. Estado reportado el 2026-10-06: Release A (`2745a25`) y Release B (`51288c2`) desplegados en staging; migración de datos corrida ahí (21 pedidos → 53 ítems, 98 entregas, 236 productos de entrega; auditoría OK y delta en 0 dos veces; proyecto de staging `aelika-staging`). En esa fecha, producción no tenía esquema, datos ni código de la Etapa 2; el código llegó a `main` en el merge `fdc0b69` (2026-10-14).
- **Fase 1a / 1b** (estados por entrega, pago y corrección) y **Clientes B2B 2a–2g**: `fdc0b69` y siguientes.
- **Portal del cliente B2B:** 4a (prueba de sesión, ya retirada) → 4b (acceso y sesión) → 4c (calendario) → 4d (crear pedido) → 4e (ver mis pedidos) → 4f (modificar) → 4g (envío real del código por WhatsApp, lado Aelika).
- **Observabilidad, Adopción, origen del pedido, modalidades de cobro, avisos internos:** octubre de 2026.
- **Hotel / Amenitiz, reglas de reserva, `ESTADO_CLIENTE` sin reenvío:** 2026-10-22, en `main` desde `44fe3dd`.

## Decisiones descartadas

- `Order` y `PedidoB2b` separados: **revertida el 2026-09-29** (entra un tercer tipo de orden, Reserva de hotel, y mantener tablas separadas obligaría a duplicar cada módulo). Ver `docs/aelika-roadmap-maestro.md` §4.
- Reactivar Accounts v1 de Stripe: ver stripe-pagos.md.
- La ruta de driver de sistema para la impresora: ver impresion-hardware.md.
- Un modelo de sucursales real para los puntos de envío: `PuntoEnvio` es deliberadamente simple.
- Migrar `Promotion` a many-to-many: solo si hay una razón real de query.
- El documento de planeación conserva el razonamiento completo detrás de las decisiones originales y las descartadas.
