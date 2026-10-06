# Etapa 2 — Pedidos B2B en la orden centralizada: migración de datos y reversa

Script: `src/scripts/etapa2-b2b.ts` (se compila a `dist/src/scripts/etapa2-b2b.js`). Núcleo: `src/scripts/etapa2/migracion-b2b.ts`
(el mismo que usan los tests: `test/characterization/etapa2-migracion.char-spec.ts`).

`PedidoB2b` (`pedidos_b2b`, `pedido_b2b_items`, `pedido_b2b_items_dia`) pasa a `Order` (tipo B2B) + `DetalleB2B` + `OrderItem`
+ `Entrega` + `EntregaItem`. **Las tablas legacy NO se borran ni se modifican** en esta etapa: dejan de escribirse.

## Mapeo
| Legacy | Nuevo |
|---|---|
| `PedidoB2b.id` / folio / clienteId / createdAt / updatedAt | `Order` (mismos valores; `Order.id` = `PedidoB2b.id`) |
| `contactoNombre/Telefono/Correo` | `Order.clienteNombre/Telefono/Correo` |
| `negocioNombre`, `semanaInicio`, `modoCobro`, `minimoPiezasAplicado`, `totalPiezas`, `subtotal`, datos del código | `DetalleB2B` (`legacyPedidoB2bId` = id del pedido: clave de idempotencia) |
| `estado` (3 valores) / `estadoPago` (2 valores) | `estadoPedido` / `estadoPago` (mismos nombres; `LISTO_ENTREGA` nunca se asigna a B2B) |
| `cancelado`, `canceladoAt`, `descuentoTotal`, `total`, `requiereFactura`, `factura*` | `Order` (mismas columnas) |
| — | `tipo = B2B`, `metodoPago = NULL`, `canalOrigen = WEB` |
| `PedidoB2bItem` (id) | `OrderItem` (mismo id, `cantidad` = suma de sus entregas, `orden` = posición física original). **Productos repetidos en un pedido se consolidan** en el primero |
| `PedidoB2bItemDia` (id) | `EntregaItem` (mismo id) en una `Entrega` por (pedido, fecha); fecha = `semanaInicio` + offset del día; nunca cantidad 0 |
| Estado de la `Entrega` | `ENTREGADA` si el pedido está `DESPACHADO`; `CANCELADA` si está cancelado; `PENDIENTE` en cualquier otro caso |

## Guarda de entorno
Dentro de Railway exige `--proyecto-esperado <nombre>` y aborta **antes de conectarse** si no coincide con `RAILWAY_PROJECT_NAME`.
Esta etapa es **solo staging** (`merry-compassion`). **El enlace de la CLI de Railway es por directorio**: pasa siempre `-p/-e`
(IDs en `scripts/etapa1/README.md`) y verifica el dominio que imprime la guarda.

## Modos
| Comando | Qué hace |
|---|---|
| `planificar` (default) | **DRY-RUN.** Lectura (`SET TRANSACTION READ ONLY`) del plan y los hallazgos + un **ensayo**: migra todo en una transacción, corre la verificación y hace ROLLBACK. No persiste nada. `--sin-ensayo` lo omite |
| `migrar --aplicar` | Una sola transacción; aborta (rollback) si hay bloqueantes o si la verificación no coincide. Idempotente |
| `auditar` | Solo lectura. Legacy ↔ nuevo: conteos por estado/pago/cancelado, sumas de total/subtotal/descuento/piezas, folios, piezas por (tenant, fecha), hash por pedido (campos, ítems, cantidades por fecha), contadores de Cliente B2B. Exit 3 si hay diferencias |
| `revertir [--aplicar]` | Ver «Reversa». Sin `--aplicar` es un ensayo con rollback |
| `--tenant <slug\|id>` | Limita el alcance |

STDOUT = NDJSON (guárdalo en un archivo local). STDERR = resumen legible sin datos personales.

### Bloqueantes (impiden migrar)
Cantidades inconsistentes (`cantidadTotal` ≠ suma de días, `totalPiezas` ≠ suma de ítems), pedidos sin ítems, días con cantidad ≤ 0,
Cliente que no es canal B2B, folios no numéricos, colisión de folio con una orden B2B existente, orden con el mismo id sin `DetalleB2B`.
Los hallazgos **informativos** (se reportan, no bloquean): tenants mixtos, tenants RETAIL_B2C con pedidos B2B (el guard los dejará sin acceso),
productos repetidos (se consolidan), semanas que no son lunes.

## Orden de despliegue (staging)
1. **Release A** — esquema aditivo (`20261005120000_etapa2_ordenes_b2b`, Railway la aplica sola al arrancar) + aislamiento B2C + este script.
   El contenedor sigue sirviendo B2B desde las tablas legacy, sin cambios visibles.
2. `planificar` (dry-run + ensayo) → **revisar hallazgos y pedir OK**.
3. `auditar` (línea base) → `migrar --aplicar` → `auditar`.
4. **Release B** — el módulo B2B sobre `Order`.
5. Corrida delta: `migrar --aplicar` (debe decir 0 migrados salvo que el contenedor viejo haya creado pedidos en el traslape) → `auditar`.
6. Humo en el panel y en `/mayoreo/<slug>`.

Por qué dos releases: con esquema y código juntos, el panel B2B quedaría vacío hasta que corra la migración de datos.
En el traslape de contenedores el viejo puede crear un pedido en `pedidos_b2b`; el delta lo copia y **aborta si hay colisión de folio**.

## Comandos (Railway)
```bash
cd backend
P=e2686010-d4f1-4431-91c2-89c880dbd243; E=b073bd1a-4f41-4707-a64c-68c1f93f0469; NOMBRE=merry-compassion
RW="railway ssh -p $P -e $E -s aelika --"
$RW sh -c "cd /app && node dist/src/scripts/etapa2-b2b.js planificar --proyecto-esperado $NOMBRE" > e2-plan.ndjson 2> e2-plan.txt
$RW sh -c "cd /app && node dist/src/scripts/etapa2-b2b.js auditar --proyecto-esperado $NOMBRE"   > e2-auditoria-antes.ndjson 2> e2-auditoria-antes.txt
$RW sh -c "cd /app && node dist/src/scripts/etapa2-b2b.js migrar --aplicar --proyecto-esperado $NOMBRE" > e2-aplicado.ndjson 2> e2-aplicado.txt
$RW sh -c "cd /app && node dist/src/scripts/etapa2-b2b.js auditar --proyecto-esperado $NOMBRE"   > e2-auditoria-despues.ndjson 2> e2-auditoria-despues.txt
```
`railway ssh` imprime avisos propios; no estorban (el parser solo lee líneas JSON del script).

## Reversa
`revertir` reconstruye el grafo `PedidoB2b` desde **todas** las órdenes B2B y las elimina de `orders`:
1. Upsert de `pedidos_b2b` (los nacidos después del corte se crean; los migrados se actualizan con estado, pago, cancelación y totales actuales).
2. Ítems y días legacy se reconstruyen desde `OrderItem` y `EntregaItem` (ids conservados; día = `fecha − semanaInicio`).
3. Recalcula los contadores de los Clientes B2B con la fórmula del código anterior (`PedidoB2b` no cancelado).
4. **Verifica** (hash por pedido: campos, ítems, cantidades por fecha) antes de borrar; si algo no coincide, rollback.
5. Borra las `Order` B2B (cascada a detalle, ítems, entregas y productos de entrega). Es obligatorio: el contenedor anterior no filtra por tipo y las mostraría en el panel B2C.
6. Con `--aplicar` imprime a STDOUT el **respaldo** de las filas que borra (`"tipo":"respaldo"`).

Secuencia: volver al contenedor anterior (Release A) → `revertir` (ensayo) → `revertir --aplicar` → `auditar`/humo.
Se pierden solo los atributos que el modelo anterior no tenía (estado/nota/hora/destino de entrega, `orden`).
La reversa está probada ida y vuelta en `etapa2-migracion.char-spec.ts` (incluye un pedido nacido solo en `Order`).

## Pruebas
`npm run test:char`:
- `etapa2-dorados` — la salida HTTP del escenario B2B (70 consultas + detectores de fuga B2C) es idéntica a los dorados
  (`test/characterization/__dorados__/etapa2-b2b.json`, generados con el código previo a la Etapa 2; **nunca se regeneran para arreglar un fallo**).
- `etapa2-migracion` — migra las filas legacy del mismo volcado y compara con los **mismos** dorados; ids, estados de entrega, idempotencia,
  consolidación, bloqueantes, verificación que detecta alteraciones, y reversa ida y vuelta.
- `etapa2-ordenes-b2b` — comportamiento nuevo: estado inicial, entregas, edición con identidad estable, invariante, propagación, aislamiento B2C.
