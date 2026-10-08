# Estados B2B por entrega — migración de datos, orden de despliegue y reversa

Diseño: `docs/diseno-operacion.md` ("Flujo operativo y estados", "Cobranza"). Script: `src/scripts/b2b-estados.ts`
(`dist/src/scripts/b2b-estados.js`); núcleo: `src/scripts/b2b-estados/migracion.ts`.

## Qué cambia en la base
- **Esquema (migración `20261008120000_b2b_estados_entrega`, aditiva, sin DROP):** `EstadoPedido` gana `EN_PROCESO` y `COMPLETADO`;
  `EstadoEntrega` gana `NO_RECOGIDA`. "Cancelado" NO es un valor: sigue siendo `Order.cancelado`. Railway la aplica sola al arrancar
  (`prisma migrate deploy`). Los valores nuevos de un enum de Postgres no se pueden quitar sin recrear el tipo: quedarían sin uso (inocuo).
- **Datos (este script, idempotente):**

| Dato | Antes | Después |
|---|---|---|
| Pedido B2B `DESPACHADO`, no cancelado | `DESPACHADO` | `COMPLETADO` (sus entregas ya están `ENTREGADA`) |
| `PENDIENTE_CONFIRMACION`, `CONFIRMADO_SURTIENDO` | — | sin cambio |
| Pedido B2B cancelado | su `estadoPedido` previo + `cancelado = true` | sin cambio de estado (el panel lo muestra "Cancelado" por el flag) |
| **Totales** de pedidos cancelados (paso aparte, `--totales-cancelados`) | total completo del pedido | solo cuentan las entregas no canceladas (los cancelados antiguos tienen todas sus entregas `CANCELADA` → 0) |

Caso dudoso: un `DESPACHADO` no cancelado con alguna entrega que no esté `ENTREGADA` se deja `COMPLETADO` y se lista en el dry-run (no debería existir:
despachar marcaba todo `ENTREGADA`).

## Orden de despliegue (cualquiera funciona; este es el recomendado)
El código nuevo **lee un B2B `DESPACHADO` como `COMPLETADO`** (`estadoB2bVisible`, y el filtro `estado=COMPLETADO` también abarca `DESPACHADO`),
así que no hay ventana en la que se vea un pedido sin migrar como algo incorrecto, y la migración de datos NO tiene que correr dentro del despliegue.
1. **Desplegar código + migración de esquema** (Railway aplica el esquema al arrancar). Mientras haya `DESPACHADO` sin migrar se ven como Completado
   y no se pueden cancelar (409), igual que ya completados.
2. **Respaldo** de la base (snapshot de Railway o `pg_dump`) y verificar dominio/proyecto (el enlace de la CLI es por directorio).
3. **Dry-run** (default): revisar conteos por estado, casos dudosos y totales de cancelados → pedir OK.
4. **Aplicar** `--aplicar --totales-cancelados` (estado + totales de cancelados, autorizado como un solo paso: las entregas Canceladas no se cobran). Guardar el STDOUT: es el respaldo para revertir. Con solo `--aplicar` se migra el estado y se omiten los totales.
5. **Verificar**: repetir el dry-run (debe decir 0 cambios) y humo en el panel (Pedidos activos / Entregas del día / Históricos).
6. El script es seguro de repetir; si entre el paso 1 y el 4 se despachó algo con un contenedor viejo, el dry-run lo recoge.

> Producción: **la Etapa 2 (B2B sobre `Order`) todavía no se ha aplicado en producción**. Esta migración opera sobre órdenes B2B (`tipo = B2B`),
> así que en producción va DESPUÉS de la migración de datos de la Etapa 2 (ver `scripts/etapa2/MIGRACION.md`); antes de eso hay 0 filas que migrar.

## Comandos (Railway)
```bash
cd backend
# staging  → proyecto aelika-staging (ids en scripts/etapa2/MIGRACION.md)
# producción → outstanding-compassion (ids en scripts/etapa1/README.md). Pasa SIEMPRE -p/-e y --proyecto-esperado.
P=<project-id>; E=<environment-id>; NOMBRE=<RAILWAY_PROJECT_NAME esperado>
RW="railway ssh -p $P -e $E -s aelika --"
$RW sh -c "cd /app && node dist/src/scripts/b2b-estados.js --proyecto-esperado $NOMBRE" > be-plan.ndjson 2> be-plan.txt            # DRY-RUN
$RW sh -c "cd /app && node dist/src/scripts/b2b-estados.js --aplicar --totales-cancelados --proyecto-esperado $NOMBRE" > be-respaldo.ndjson 2> be-aplicado.txt   # SOLO tras OK del dry-run
$RW sh -c "cd /app && node dist/src/scripts/b2b-estados.js --proyecto-esperado $NOMBRE" 2> be-verificacion.txt                  # debe decir 0 cambios (estado y totales)
```
Local: `npx tsx --env-file=.env src/scripts/b2b-estados.ts [--aplicar]`.

## Reversa
`--revertir <respaldo.ndjson>` restaura `estadoPedido` y `subtotal/descuentoTotal/total` de cada pedido guardado en el respaldo, en una transacción; se niega
si un pedido cambió después de la migración (otro estado o total distinto del que escribió el script), salvo `--forzar`. Los pedidos que ya se hayan
cerrado/editado con el código nuevo no se pueden devolver a `DESPACHADO` sin perder esa historia: por eso se revierte **antes** de operar con el código nuevo,
o con `--forzar` asumiéndolo. Probado ida y vuelta en local.

Para volver al código anterior: las filas `COMPLETADO`/`EN_PROCESO` y entregas `NO_RECOGIDA` no existen para él → revertir primero los datos
(`--revertir`) y después desplegar el contenedor anterior; los valores de enum que sobran no estorban.

## Notificaciones
Las reglas EVENTO_PEDIDO de origen `PEDIDO_B2B` con `estatus = DESPACHADO` quedan intactas pero **ya no se disparan** (B2B no despacha). El único evento de B2B sigue
siendo Confirmado. No se agregaron eventos para En proceso / Completado / cierre de entrega.

## Producción — orden completo (NO ejecutado; requiere OK explícito en cada paso)
Producción: proyecto `outstanding-compassion` (`api.aelika.com`), ids en `scripts/etapa1/README.md`. Hoy NO tiene la Etapa 2: el B2B vive en las tablas legacy
(`pedidos_b2b*`). Pasa SIEMPRE `-p/-e` y `--proyecto-esperado outstanding-compassion`; verifica el dominio que imprime la guarda antes de seguir.
Cada comando de datos: primero dry-run, revisar y pedir OK; después `--aplicar`; después verificar.

1. **Respaldo completo — lo saca Santiago, a mano, con un snapshot de Railway ANTES de cualquier paso de esta lista.** Desde la sesión de Claude Code no hay `pg_dump` ni acceso público a la base de producción, así que Claude no puede sacarlo; ningún paso siguiente se ejecuta sin que Santiago confirme que el snapshot existe (y anotar cuál es). Claude solo puede exportar las filas B2B que cada script toca (NDJSON), que es un complemento, no un sustituto. Confirmar que Etapa 1/1b-a ya están en producción (prerrequisito de la Etapa 2).
2. **Etapa 2 · Release A** (esquema aditivo `20261005120000_etapa2_ordenes_b2b` + aislamiento B2C + scripts). El panel B2B sigue sirviéndose desde las tablas legacy.
3. **Etapa 2 · datos** (`scripts/etapa2/MIGRACION.md`): `planificar` (dry-run + ensayo) → revisar hallazgos → OK → `auditar` (línea base) → `migrar --aplicar` → `auditar`.
4. **Etapa 2 · Release B** (módulo B2B sobre `Order`).
5. **Etapa 2 · delta**: `migrar --aplicar` otra vez (debe migrar 0 salvo pedidos nacidos en el traslape) → `auditar`. Humo en el panel y en `/mayoreo/<slug>`.
6. **Estados por entrega · código + esquema** (esta entrega): desplegar; la migración `20261008120000_b2b_estados_entrega` corre sola al arrancar. Con el código nuevo, un B2B `DESPACHADO` sin migrar ya se ve Completado.
7. **Estados por entrega · datos** (este documento): dry-run → revisar conteos por estado, casos dudosos y totales de cancelados → OK → `--aplicar --totales-cancelados` guardando el respaldo → repetir dry-run (0 cambios).
8. **Humo final:** Pedidos activos (Por confirmar/Confirmado/En proceso), Entregas del día (cerrar una entrega en un pedido de prueba), Históricos (filtro de los 5 estados), Inicio.

Por qué ese orden: los pasos 6-7 operan sobre órdenes B2B (`tipo = B2B`); antes del paso 3 no existen en `orders` y el script no tendría nada que migrar.
Reversa: la de cada paso está en su documento (`--revertir` de este script; `revertir` de la Etapa 2). Se revierte en orden inverso: primero esta migración de datos, luego la de la Etapa 2.
