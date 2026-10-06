# Etapa 1 — `DetalleB2C`: scripts de verificación y de validación de la migración

Migración: `prisma/migrations/20260930120000_etapa1_detalles_b2c/`. Railway la aplica **sola al arrancar**
cada contenedor (`railway.json` → `npm run start:prod` → `prisma migrate deploy && node dist/src/main`); si
falla, el servicio no levanta. No hay paso manual.

## ⚠️ Railway: el enlace es POR DIRECTORIO
`railway status` / `railway ssh` usan el proyecto enlazado **en el directorio actual**. Desde `backend/` hoy
está enlazado **producción** (`outstanding-compassion`, `api.aelika.com`); desde la raíz del repo puede estar
enlazado staging. **Siempre** pasa el destino explícito y verifícalo:

| | Proyecto | Project ID | Environment ID |
|---|---|---|---|
| staging | `merry-compassion` (`aelika-staging.up.railway.app`) | `e2686010-d4f1-4431-91c2-89c880dbd243` | `b073bd1a-4f41-4707-a64c-68c1f93f0469` |
| producción | `outstanding-compassion` (`api.aelika.com`) | `f0552b14-0b13-4719-b2aa-c887de82f7d6` | `efee9152-3a8a-49b3-af61-ee5f27a8e02a` |

`volcar-staging-saneado.mjs` aborta si `VOLCADO_PROYECTO_ESPERADO` no coincide con el proyecto del contenedor.

## `verificar.sql` + `verificar-runner.mjs` (solo lectura)
Todo corre dentro de `BEGIN READ ONLY`. Comprueba: conteo de `orders` vs `detalles_b2c`; órdenes sin detalle
(lista de folios, y cuántas son anteriores/posteriores al corte = `finished_at` de la migración; **antes del
corte deben ser 0**, las posteriores son las del traslape de despliegue); detalles huérfanos y duplicados (0);
cada campo del detalle contra la columna vieja con `IS DISTINCT FROM` (0 diferencias); suma de `total` por
tenant; conteo por `tipo` (todo `B2C`).

```bash
# Local (antes y después de migrar una base)
DATABASE_URL=postgresql://... node scripts/etapa1/verificar-runner.mjs --solo-linea-base antes.json   # ANTES
DATABASE_URL=postgresql://... node scripts/etapa1/verificar-runner.mjs --comparar antes.json          # DESPUÉS
```
Salida con código 0 = todo correcto, 1 = alguna verificación falló.

**Etapa 1b-a — `--hasta <fecha ISO>`.** Desde que se retiró la escritura doble, las órdenes nuevas dejan las columnas viejas
de `orders` en su valor por defecto, así que compararlas contra el detalle marcaría diferencias falsas. Con `--hasta` (el
instante del despliegue de la 1b-a, ej. `--hasta 2026-10-07T18:00:00Z`) la comparación campo a campo solo cubre las órdenes
creadas ANTES de ese instante; el resto de las verificaciones (conteos, sin detalle, huérfanos, duplicados, tipo B2C) no cambia.
El runner imprime cuántas órdenes quedaron fuera. Sin `--hasta` compara todas, como antes. En Railway:
`VERIFICAR_SQL_B64=$S node /tmp/v.mjs --hasta <fecha>` (los argumentos van después de `/tmp/v.mjs`).

### En Railway (sin `psql`, sin proxy público): por `railway ssh`
El contenedor trae `pg` (dependencia de producción). Se envía el runner y el SQL en base64 (no depende de que
`scripts/` esté desplegado). **Ajusta `-p`/`-e` al entorno destino** (tabla de arriba):
```bash
cd backend
R=$(base64 < scripts/etapa1/verificar-runner.mjs | tr -d '\n'); S=$(base64 < scripts/etapa1/verificar.sql | tr -d '\n')
railway ssh -p <PROJECT_ID> -e <ENVIRONMENT_ID> -s aelika -- sh -c \
  "echo $R | base64 -d > /tmp/v.mjs && cd /app && VERIFICAR_SQL_B64=$S node /tmp/v.mjs; rm -f /tmp/v.mjs"
```
(Línea base en el destino ANTES de desplegar: añade `--solo-linea-base /tmp/antes.json` y, después,
`--comparar /tmp/antes.json`; el archivo vive en el contenedor, cópialo con el mismo `ssh` si lo necesitas.)

## Validar la migración con datos (sin tocar staging ni producción)
1. **Base en el estado PREVIO** (44 migraciones) con un worktree del commit base:
   ```bash
   git worktree add --detach /tmp/wt 99df8c9 && ln -s "$PWD/node_modules" /tmp/wt/backend/node_modules
   docker exec aelika-postgres psql -U aelika -d postgres -c "CREATE DATABASE etapa1_prueba"
   (cd /tmp/wt/backend && DATABASE_URL=postgresql://.../etapa1_prueba?schema=public npx prisma migrate deploy)
   ```
2. **Cargar datos**: sintéticos (`psql < scripts/etapa1/sintetico.sql`) o un volcado saneado de staging:
   `volcar-staging-saneado.mjs` (solo lectura, enmascara datos personales y vacía secretos; solo las tablas del
   backfill y sus FKs; **nunca** users/notificaciones/reglas/lealtad) → `cargar-volcado.mjs` (solo bases locales
   `etapa1_*`).
3. Línea base → **aplicar la migración nueva** (`DATABASE_URL=... npx prisma migrate deploy` desde `backend/`)
   → `verificar-runner.mjs --comparar`.
4. Sin drift esquema↔migraciones (requiere una base shadow; `prisma.config.ts` no define `shadowDatabaseUrl`, se usa
   un config temporal): `npx prisma migrate diff --config <tmp.config.ts> --from-migrations prisma/migrations --to-schema prisma/schema.prisma` → "No difference detected".
5. Borra las bases `etapa1_*` y el worktree al terminar.

## Reversa
No hay script: la escritura doble dejaba las columnas viejas de `orders` siempre al día. Volver al contenedor
anterior no pierde nada (su cliente Prisma ignora la tabla y la columna nuevas; `orders.tipo` tiene DEFAULT).
Las órdenes que cree el contenedor anterior sin detalle se leían por el respaldo de lectura
(`aRespuestaOrder`) — respaldo retirado en la Etapa 1b-a (ver `scripts/etapa1/` y `orders/order-respuesta.ts`).
