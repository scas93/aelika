# Modalidades de cobro B2B — migración de datos (Configuración de pagos, Fase 0)

Script: `src/scripts/modalidades-cobro-b2b.ts` (se compila a `dist/src/scripts/modalidades-cobro-b2b.js`).

## Qué hace
Por cada negocio de mayoreo (`RETAIL_B2B`):

1. **Modalidades activas** (`Tenant.modalidadesCobroB2b`): queda activa **solo** la modalidad de su `pedidoB2bModoCobro` actual.
   Solo se escribe si el negocio sigue en el default de la columna (`["AL_FINAL"]`) y su modo es `AL_INICIO`; un negocio ya
   configurado desde Ajustes → Pagos **nunca se pisa** (se reporta en «Negocios ya configurados»).
2. **Clientes con `modalidadPago = NULL`** (activos **y de baja**) reciben la modalidad vigente de su negocio
   (`pedidoB2bModoCobro`): es exactamente lo que hoy resuelve «Igual que el negocio».
3. **Clientes con modalidad explícita no se tocan**, aunque su modalidad quede inactiva en el negocio: se reportan aparte
   («clientes con modalidad inactiva»); su ficha mostrará el aviso.
4. **Pedidos intactos**: `detalles_b2b.modoCobro` no se toca; el script compara conteo y huella (sha256 de `id:modoCobro`)
   antes y después y, si algo difiere, hace rollback.

Otras verificaciones con rollback automático: ningún cliente B2B del alcance queda sin modalidad y ningún negocio queda sin
modalidades activas. Idempotente: una segunda corrida con `--aplicar` no encuentra nada que cambiar.

## Modos
| Comando | Qué hace |
|---|---|
| (sin flags) | **PRUEBA EN SECO.** Hace el trabajo real dentro de una transacción y la **deshace** al final: el «después» que reporta es el que dejaría `--aplicar`. No escribe nada. |
| `--aplicar` | Una sola transacción, verificada. |
| `--revert <archivo>` | Restaura los valores previos (modalidad `NULL` + `updatedAt` exacto de los clientes; casillas previas de los negocios). Se niega si algo cambió después (p. ej. alguien ya asignó otra modalidad), salvo `--forzar`. |
| `--tenant <slug\|id>` | Limita el alcance a un negocio de mayoreo (default: todos). |
| `--proyecto-esperado <nombre>` | Guarda: aborta **antes de conectarse** si `RAILWAY_PROJECT_NAME` no coincide. Obligatorio dentro de Railway. |

**Salidas.** `stdout` = NDJSON (`"_":"modalidades-cobro-b2b"`): cabecera, `antes`, `despues` (por negocio: casillas, clientes
por modalidad incluido `NULL`, activos/de baja, pedidos por `modoCobro` y huella), un registro por cambio y la línea `fin`.
**Guárdalo en un archivo local**: es el respaldo para `--revert` (sirve el de `--aplicar` y el de la prueba en seco). `stderr` =
resumen legible, sin datos personales (ids truncados a 8).

## Orden de despliegue (IMPORTANTE)
El backend endurecido **exige modalidad en todo cliente B2B** y los pedidos nuevos ya no heredan del negocio: un cliente con
`NULL` no puede recibir pedidos nuevos (409 «no tiene modalidad de pago asignada») hasta que corra el script.

1. **Desplegar** esta versión (la migración `20261022120000_modalidades_cobro_b2b` corre sola con `prisma migrate deploy`; es
   aditiva: una columna con default). Todos los negocios quedan con `["AL_FINAL"]` y los clientes `NULL` siguen igual.
2. **Prueba en seco** (revisar el resumen: negocios que cambian, clientes que reciben modalidad, pedidos idénticos).
3. **`--aplicar`**, de inmediato (la ventana entre 1 y 3 es la única en que un cliente `NULL` no puede recibir pedidos).
4. Revisar en Ajustes → Pagos de cada negocio que las casillas son las esperadas.
5. El `NOT NULL` de `clientes.modalidadPago` y el borrado de `pedidoB2bModoCobro` quedan para un cambio posterior.

Banetto (producción) no tiene pedidos ni pagos reales: el riesgo de la ventana es nulo. En staging hay datos con ambos modos.

## Railway
**El enlace de la CLI es por directorio: nunca confíes en `railway status`.** Pasa siempre `-p`/`-e`. IDs (ver `scripts/etapa1/README.md`):

| | Project ID | Environment ID |
|---|---|---|
| staging | `e2686010-d4f1-4431-91c2-89c880dbd243` | `b073bd1a-4f41-4707-a64c-68c1f93f0469` |
| producción | `f0552b14-0b13-4719-b2aa-c887de82f7d6` | `efee9152-3a8a-49b3-af61-ee5f27a8e02a` |

`--proyecto-esperado` compara contra `RAILWAY_PROJECT_NAME` **del contenedor**; el nombre cambió entre documentos
(`merry-compassion` vs. `aelika-staging`), así que primero léelo:

```bash
cd backend
P=e2686010-d4f1-4431-91c2-89c880dbd243; E=b073bd1a-4f41-4707-a64c-68c1f93f0469   # STAGING
NOMBRE=$(railway ssh -p $P -e $E -s aelika -- sh -c 'echo $RAILWAY_PROJECT_NAME' | tail -1); echo "$NOMBRE"   # debe ser el de staging
# 1) PRUEBA EN SECO — guarda stdout (respaldo) y stderr (resumen) por separado
railway ssh -p $P -e $E -s aelika -- sh -c "cd /app && node dist/src/scripts/modalidades-cobro-b2b.js --proyecto-esperado $NOMBRE" \
  > modalidades-seco.ndjson 2> modalidades-seco.txt
# 2) revisa modalidades-seco.txt; si está bien:
railway ssh -p $P -e $E -s aelika -- sh -c "cd /app && node dist/src/scripts/modalidades-cobro-b2b.js --aplicar --proyecto-esperado $NOMBRE" \
  > modalidades-aplicado.ndjson 2> modalidades-aplicado.txt
# 3) si hiciera falta volver atrás: pega el archivo dentro del contenedor y corre --revert
```
Nota: `railway ssh` imprime avisos propios; no estorban (el parser solo lee líneas JSON del script). Producción: mismos
comandos con los IDs de producción, **solo después** de revisar la prueba en seco.

## Probarlo en local
`test/characterization/modalidades-cobro-migracion.char-spec.ts` corre el script real contra la base `_test` (prueba en seco
sin escribir, aplicar idempotente, revert exacto, `--forzar`, archivo truncado, guarda de proyecto). A mano:
```bash
npx tsx src/scripts/modalidades-cobro-b2b.ts > seco.ndjson            # prueba en seco
npx tsx src/scripts/modalidades-cobro-b2b.ts --aplicar > aplicado.ndjson
npx tsx src/scripts/modalidades-cobro-b2b.ts --revert aplicado.ndjson
```
