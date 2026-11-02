# Programa de Lealtad (tarjeta de sellos)

Módulo apagable por negocio (`MODULOS = ['LEALTAD', …]`, `Tenant.modulosDesactivados`; ver [architecture.md](architecture.md)). Con el módulo apagado: 404 en rutas públicas y 403 en las del panel. Programa de Lealtad se oculta para Banetto (mayoreo).

> Este documento se escribió leyendo el código (el `CLAUDE.md` anterior solo mencionaba Lealtad de pasada). Ciertos comentarios en `backend/src/lealtad/wallet-pass.service.ts` dicen "ver CLAUDE.md" para el detalle del plan de WalletWallet; ese detalle nunca estuvo en `CLAUDE.md`. La fuente es el propio código.

## Qué hace

Cada cliente del programa tiene **una tarjeta** (`LoyaltyCard`, 1:1 con `Cliente`, resuelta con upsert). Acumula **10 sellos** (`SELLOS_PARA_PREMIO = 10`); al llegar a 10 la tarjeta pasa a `PREMIO_DISPONIBLE` y debe redimirse antes de seguir sellando. Máximo **1 sello por tarjeta por día**.

- `LoyaltyCard.token`: valor del QR personal (alta entropía, `generateApiKey()`, no UUID). `serialNumber`: identificador del pase de wallet (null hasta que se crea).
- `LoyaltyVisit`: bitácora de sellos (un evento por visita; sin "quién registró"). `LoyaltyRedemption`: bitácora de canjes. FKs `Restrict`: no se pierde historial al borrar un `Cliente`.
- La regla de 1 sello por día **no es una constraint de DB**: la garantiza el lock de fila sobre `LoyaltyCard` en `LealtadService.registrarCompra`. Mismo lock en `redimirPremio`, así un canje y un sello simultáneos no leen el mismo estado viejo.
- Errores con código (`lealtad-errors.ts`): 409 `SELLO_YA_REGISTRADO_HOY`, 409 `PREMIO_PENDIENTE`, 409 al redimir sin premio disponible.

## API

| Ruta | Quién | Para qué |
|---|---|---|
| `GET /lealtad/clientes` | 3 roles | Clientes inscritos |
| `POST /lealtad/clientes` | 3 roles | Alta de cliente en el programa (crea `Cliente`, tarjeta y pase) |
| `POST /lealtad/registrar-compra` | 3 roles | Registrar un sello |
| `POST /lealtad/redimir-premio` | 3 roles | Canjear premio |
| `POST /public/lealtad/tenants/:slug/clientes` | público | Autoalta (`nombre`, `telefono`) desde `/lealtad/[slug]` |

Todas llevan `@RequiereModulo('LEALTAD')`. Lealtad usa la normalización global de teléfono (trunca a 10 dígitos; ver hoteles-reservas.md). Un reintento de la alta con el mismo teléfono vuelve a intentar solo la creación del pase: el `Cliente`/`LoyaltyCard` no se revierten si falla WalletWallet.

## Pase de wallet (`wallet-pass.service.ts`)

Llama a WalletWallet API (`https://api.walletwallet.dev/api/passes`, `Authorization: Bearer ${WALLETWALLET_API_KEY}`) con timeout de 8 s, porque hay un operador esperando la pantalla. Pase **solo de texto** (el plan gratis no incluye `stripURL`; el servicio no manda `backgroundURL`/`stripURL`/`logoURL`/`iconURL`). El contador de sellos va en `secondaryFields`; la notificación de lock screen usa un campo trasero dedicado (`backFields`).

### Alta de un teléfono que ya tiene pase (rama 3 de `altaCliente`)

`altaCliente` (panel y público) tiene 3 ramas: cliente nuevo (crea tarjeta y pase), tarjeta existente sin pase (reintento: crea el pase) y tarjeta existente con pase. En la tercera, `WalletPassService.refrescarYObtenerLink` entrega el link de **su misma tarjeta**, sin crear otra:

- El link es `<base>/p/<serial>` (`urlCompartir`; «Share a Pass» de WalletWallet: vive mientras exista el pase y no es de un solo uso). La base sale de `WALLETWALLET_SHARE_BASE_URL` (opcional; por defecto `https://pass.walletwallet.dev`). Se deriva porque **ni el PUT ni `GET /api/passes/:serial` de WalletWallet devuelven `shareUrl`** y Aelika no lo guarda (en `LoyaltyCard` solo hay `serialNumber` y `token`); por eso las tarjetas existentes funcionan sin migración ni script.
- Además se hace un `PUT /api/passes/:serial` **best-effort** (re-sincroniza nombre y contador). Su fallo (4xx/5xx/429/timeout/red) solo queda en logs y **no bloquea** la entrega del link.
- **404 del PUT** (WalletWallet no conoce ese serial): no se entrega el link derivado (llevaría a una tarjeta inexistente); la alta responde 502 con un mensaje explícito. **Comportamiento provisional** (aprobado así por ahora): pase no encontrado en WalletWallet, sin regeneración automática de la tarjeta y sin script de detección de seriales huérfanos.
- La respuesta es `{ loyaltyCard, pase: { serialNumber, shareUrl } }`. En el resto de operaciones (sello, canje) `pase` es el JSON del PUT, **sin `shareUrl`**; por eso en el frontend `WalletPassResultado.shareUrl` es opcional y todo uso pasa por `linkTarjeta()` (`frontend/lib/lealtad-pase.ts`): el panel solo muestra/copia un link válido y la página pública solo redirige con uno; sin link muestran un error claro, nunca una caja vacía ni una pantalla colgada.

**Riesgo conocido y aceptado:** el endpoint público entrega el link de la tarjeta a quien escriba un teléfono ya inscrito (con cualquier nombre). El pase incluye el `token` del QR personal, así que quien conozca el teléfono de otro cliente puede agregar esa tarjeta a su wallet. El impacto es acotado (sellar y canjear requiere que el personal escanee el QR), pero no hay verificación de identidad.

## Panel y público

- `/dashboard/lealtad` (`frontend/app/dashboard/lealtad/`): pestañas **Registrar cliente**, **Registrar compra** (con `qr-scanner.tsx`, `@zxing/browser`) y **Clientes inscritos**.
- `/lealtad/[slug]`: alta pública.
- Pruebas: `backend/src/lealtad/clientes-inscritos.spec.ts`, `wallet-pass.service.spec.ts` (link y PUT best-effort), `alta-cliente-link.spec.ts` (rama 3 y rama 2, panel y público), `frontend/app/dashboard/lealtad/*.test.tsx`, `frontend/app/lealtad/[slug]/page.test.tsx`, `frontend/lib/lealtad-pase.test.ts`.
- Migraciones: `20260917235544_lealtad_fase0_schema_andamiaje`, `20260918000817_lealtad_fase1_pin_rate_limit`.
