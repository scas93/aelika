# Etapa 0c — datos B2B de prueba en staging

Siembra pedidos B2B en `banetto-mayorista` y `dominique-ansel` (staging) para cubrir todas las variantes antes de
unificar `PedidoB2b` en `Order` (Etapa 2). **Solo por los flujos reales** (endpoints públicos y de admin); la base
se usa únicamente para leer (`BEGIN READ ONLY`). Nunca toca producción ni los pedidos originales.

Archivos: `sembrar-b2b-staging.mjs` (`--dry-run` por defecto / `--aplicar` / `--restaurar`),
`auditar-b2b-staging.mjs` (solo lectura, tabla de variantes antes/después), `comun.mjs` (guarda de proyecto).

## Guarda de proyecto
Los scripts abortan **antes de leer o escribir** si `RAILWAY_PROJECT_ID` ≠ `e2686010-d4f1-4431-91c2-89c880dbd243`
(`merry-compassion`). Se compara por ID, no por nombre de entorno (en staging el entorno se llama "production").
Fuera de Railway solo corren con `SEED_ENTORNO_LOCAL=1` y una `DATABASE_URL` en localhost (prueba local).
Todo comando de Railway lleva `-p/-e` explícitos (el enlace de la CLI es por directorio).

| | Project ID | Environment ID |
|---|---|---|
| staging (`merry-compassion`) | `e2686010-d4f1-4431-91c2-89c880dbd243` | `b073bd1a-4f41-4707-a64c-68c1f93f0469` |

## Cómo correrlo
Credenciales solo por variables de entorno (nunca se imprimen ni se guardan): `SEED_DOMINIQUE_EMAIL`/`_PASSWORD`
(rol DUENO: cambia `pedidoB2bModoCobro`) y `SEED_BANETTO_EMAIL`/`_PASSWORD` (GERENTE o DUENO). Expórtalas en tu
terminal y evita contraseñas con comillas dobles, `$` o `` ` `` (se expanden en tu shell al armar el comando).

```bash
cd backend
S=$(base64 < scripts/etapa2/sembrar-b2b-staging.mjs | tr -d '\n'); C=$(base64 < scripts/etapa2/comun.mjs | tr -d '\n'); A=$(base64 < scripts/etapa2/auditar-b2b-staging.mjs | tr -d '\n')
RW="railway ssh -p e2686010-d4f1-4431-91c2-89c880dbd243 -e b073bd1a-4f41-4707-a64c-68c1f93f0469 -s aelika --"
PREP="mkdir -p /tmp/e2 && echo $C | base64 -d > /tmp/e2/comun.mjs && echo $S | base64 -d > /tmp/e2/sembrar-b2b-staging.mjs && echo $A | base64 -d > /tmp/e2/auditar-b2b-staging.mjs && cd /app"
ENVS="SEED_DOMINIQUE_EMAIL=\"$SEED_DOMINIQUE_EMAIL\" SEED_DOMINIQUE_PASSWORD=\"$SEED_DOMINIQUE_PASSWORD\" SEED_BANETTO_EMAIL=\"$SEED_BANETTO_EMAIL\" SEED_BANETTO_PASSWORD=\"$SEED_BANETTO_PASSWORD\""

# 1) Auditoría ANTES (solo lectura)
$RW sh -c "$PREP && node /tmp/e2/auditar-b2b-staging.mjs; rm -rf /tmp/e2"
# 2) Dry-run: plan + guarda de notificaciones (solo lectura, sin credenciales)
$RW sh -c "$PREP && node /tmp/e2/sembrar-b2b-staging.mjs --dry-run; rm -rf /tmp/e2"
# 3) Aplicar
$RW sh -c "$PREP && $ENVS node /tmp/e2/sembrar-b2b-staging.mjs --aplicar; rm -rf /tmp/e2"
# 4) Auditoría DESPUÉS
$RW sh -c "$PREP && node /tmp/e2/auditar-b2b-staging.mjs; rm -rf /tmp/e2"
# Rescate si algo interrumpió --aplicar durante la fase AL_INICIO (valor original conocido: AL_FINAL)
$RW sh -c "$PREP && $ENVS node /tmp/e2/sembrar-b2b-staging.mjs --restaurar --modo-original=AL_FINAL; rm -rf /tmp/e2"
```
`--aplicar` se niega (exit 3, sin escribir nada) si algún tenant tiene reglas `EVENTO_PEDIDO` activas o webhook de
Botpress configurado: `avanzar`/`cancelar`/`marcar-pagado` podrían mandar mensajes reales. Con `--aplicar --permitir-notificaciones` continúa y lo declara en la salida (`notificaciones_permitidas`); úsalo solo si staging es desechable (los clientes sembrados tienen teléfonos ficticios). Es idempotente: la clave
es el marcador de variante, no la fecha; una corrida interrumpida se reanuda donde quedó. Si encuentra
`dominique-ansel` en `AL_INICIO` (corrida interrumpida), lo restaura antes de empezar.

## Qué se siembra (todo en la `semanaDestino`)
Marcador en `negocioNombre`: `Negocio Ficticio Seed <id> [SEED-0c:<id>]` (`PedidoB2b` no tiene notas).
| id | tenant | flujo | variante |
|---|---|---|---|
| d01 | dominique-ansel | admin | AL_FINAL, despachado y pagado |
| d02 | dominique-ansel | público | con factura y código `SEED0C_DOM10` |
| d03 | dominique-ansel | público | un solo producto, 2 días, en el mínimo |
| d04 | dominique-ansel | admin | código `SEED0C_AGOTADO` (usosMaximos=1), cancelado |
| d05 | dominique-ansel | admin | AL_INICIO, pagado y confirmado |
| d06 | dominique-ansel | admin | AL_INICIO, pendiente |
| b01 | banetto-mayorista | público | código `SEED0C_BAN10`, sin factura |
| b02 | banetto-mayorista | admin | código `SEED0C_BAN10` (el admin no captura factura: hueco congelado en la caracterización) |
| b03 | banetto-mayorista | admin | cancelado |
| b04 | banetto-mayorista | admin | despachado y pagado |
| b05 | banetto-mayorista | admin | despachado sin pagar |
| b06 | banetto-mayorista | público | bajo el mínimo (30% del mínimo), queda pendiente |

Códigos por CRUD de admin: `SEED0C_BAN10`, `SEED0C_DOM10` (vigentes), `SEED0C_AGOTADO` (agotado al gastarlo d04;
cancelar no libera el cupo hoy), `SEED0C_VENCIDO` (`fechaLimite` 2026-01-01).
Los pedidos públicos de banetto (b01, b06) solo se crean si la ventana de recepción está abierta; si no, el script los
reporta "no creado" (no edita la ventana). `AL_INICIO` solo por admin (el público lo rechaza con 409).

## Valores ficticios
- Teléfonos de 10 dígitos todo ceros: `0000000001`–`0000000006` (b01–b06) y `0000000101`–`0000000106` (d01–d06).
- Correos `seed0c-<id>@example.com`; contacto `Contacto Ficticio Seed`.
- Factura (d02): razón social `Empresa Ficticia Seed SA de CV`, RFC `XAXX010101000` (RFC genérico), régimen `601`,
  uso CFDI `G03`, CP `00000`, correo `factura-seed0c@example.com`.

## Limpiar lo sembrado (SQL, orden obligatorio: pedidos → clientes → códigos)
Borrar no es "insertar con SQL"; no hay endpoint para borrar pedidos B2B. Ejecutar en una transacción y revisar los conteos.
```sql
BEGIN;
DELETE FROM pedidos_b2b WHERE "negocioNombre" LIKE '%[SEED-0c:%';                       -- items/días en cascada
DELETE FROM clientes WHERE canal = 'B2B' AND telefono LIKE '00000000%'                  -- FK Restrict: ya sin pedidos
  AND "tenantId" IN (SELECT id FROM tenants WHERE slug IN ('banetto-mayorista','dominique-ansel'));
DELETE FROM pedido_b2b_codigos_descuento WHERE codigo LIKE 'SEED0C\_%';
-- verificar: SELECT count(*) FROM pedidos_b2b WHERE "negocioNombre" LIKE '%[SEED-0c:%';  -- 0
COMMIT;
```
Los contadores de los `Cliente` no sembrados no se tocan (los sembrados se borran). Si alguna vez se necesitara
recalcularlos, usa `backend/src/scripts/corregir-contadores.ts` (ver `backend/scripts/contadores/README.md`).
Tras limpiar, comprueba que `pedidoB2bModoCobro` de `dominique-ansel` sigue en `AL_FINAL`.
