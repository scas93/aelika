# Corrección de contadores de `Cliente` (Pedidos TARJETA no pagados, Parte A3)

Script: `src/scripts/corregir-contadores.ts` (se compila a `dist/src/scripts/corregir-contadores.js`).
Recalcula `totalPedidos` / `primerPedidoAt` / `ultimoPedidoAt` con **la misma función que usa la app**
(`calcularContadoresCliente` / `recalcularContadoresCliente`, `src/clientes/cliente-contadores.ts`):
B2C cuenta `Order` con `estadoPago = PAGADO`; B2B cuenta `PedidoB2b` con `cancelado = false`; fechas = `createdAt`
del pedido; sin pedidos contables = `totalPedidos 0` y fecha de alta del Cliente.

**Requisito:** el entorno destino debe tener desplegado este código (A2 + A3) — el script vive en el build.
Corre primero en staging. En producción lo corre Santiago, después de revisar el dry-run.

## Modos
| Comando | Qué hace |
|---|---|
| (sin flags) | **DRY-RUN.** Transacción de solo lectura, no escribe nada. |
| `--aplicar` | Una sola transacción; solo escribe a los clientes que cambian; verifica cada uno y, al final, que TODOS los del alcance coinciden con el cálculo. Si algo no coincide: rollback y sin salida en stdout. |
| `--revert <archivo>` | Restaura los valores previos (incluido `updatedAt`) de un archivo guardado, en una transacción, y lo verifica. Si un cliente cambió después de la corrección (p. ej. entró un pedido nuevo) se niega, salvo `--forzar`. |
| `--tenant <slug\|id>` | Limita el alcance a un negocio (default: todos, B2C y B2B). |
| `--proyecto-esperado <nombre>` | Guarda: aborta **antes de conectarse** si `RAILWAY_PROJECT_NAME` no coincide. Obligatorio dentro de Railway. |

**Salidas.** `stdout` = NDJSON (una línea JSON por registro, marcadas `"_":"corregir-contadores"`): cabecera, un
`cambio` por cliente (ids completos, valores `antes` y `despues`) y una línea `fin`. **Guárdalo en un archivo local**:
es el respaldo para `--revert` (sirve el de `--aplicar` o el del dry-run; `--revert` ignora cualquier línea que no sea
del script y se niega si falta la línea `fin`). `stderr` = resumen legible sin datos personales (ids truncados a 8, lista
aparte de clientes de Lealtad cuyo `primerPedidoAt` cambia).

Idempotente: una segunda corrida con `--aplicar` no encuentra nada que cambiar y no escribe (ni `updatedAt`).

## Railway (mismo patrón que Etapa 1: `-p`/`-e` explícitos + guarda)
IDs en `scripts/etapa1/README.md`. **El enlace de la CLI es por directorio: nunca confíes en `railway status`.**
```bash
cd backend
P=<PROJECT_ID>; E=<ENVIRONMENT_ID>; NOMBRE=<outstanding-compassion|merry-compassion>
# 1) DRY-RUN — guarda stdout (respaldo) y stderr (resumen) por separado
railway ssh -p $P -e $E -s aelika -- sh -c "cd /app && node dist/src/scripts/corregir-contadores.js --proyecto-esperado $NOMBRE" \
  > contadores-dry-run.ndjson 2> contadores-dry-run.txt
# 2) revisa contadores-dry-run.txt; si está bien:
railway ssh -p $P -e $E -s aelika -- sh -c "cd /app && node dist/src/scripts/corregir-contadores.js --aplicar --proyecto-esperado $NOMBRE" \
  > contadores-aplicado.ndjson 2> contadores-aplicado.txt
# 3) si hiciera falta volver atrás: sube el archivo o pégalo por base64 y corre --revert dentro del contenedor
```
Nota: `railway ssh` imprime avisos propios; no estorban (el parser solo lee líneas JSON del script). Si tu versión de
la CLI mezcla stderr en stdout, el archivo sigue sirviendo para `--revert`.

## Probarlo en local
```bash
docker exec aelika-postgres psql -U aelika -d postgres -c "CREATE DATABASE contadores_prueba"
export DATABASE_URL=postgresql://aelika:<pw>@localhost:5432/contadores_prueba?schema=public
npx prisma migrate deploy && npx tsx scripts/contadores/sintetico.ts   # 10 clientes, 2 tenants, casos reales
npx tsx src/scripts/corregir-contadores.ts > dry.ndjson                # dry-run
npx tsx src/scripts/corregir-contadores.ts --aplicar > aplicado.ndjson
npx tsx src/scripts/corregir-contadores.ts --revert aplicado.ndjson
```
`test/characterization/corregir-contadores.char-spec.ts` automatiza estos casos (dry-run sin escribir, aplicar
idempotente, revert exacto, `--forzar`, archivo truncado, guarda de proyecto).
