# Seeds, datos de demo y scripts de corrección de datos

Todos los seeds viven en `backend/prisma/`, usan `PrismaPg` con `DATABASE_URL` y **escriben en la base a la que apunte `backend/.env`**: confirma el destino antes de correrlos. Los de negocio real usan `find-then-create-or-update` para `Category`/`Product`/`PuntoEnvio` (no tienen unique key natural más que `id`) y `upsert()` real para `Tenant`/`User` (`slug`/`email` únicos): correrlos de nuevo actualiza los datos si el JSON cambia, en vez de saltárselos.

## Seeds

| Seed | Comando | Datos | Tenant(s) | Login de prueba |
|---|---|---|---|---|
| Principal de desarrollo | `npm run prisma:seed` (`prisma/seed.ts`) | Tenant demo con catálogo, pedidos de ejemplo y usuarios | `pizzeria-demo` | `demo@aelika.com` / `demo1234` |
| Panadería Banetto (menudeo) | `npm run seed:banetto` | `prisma/data/seed-banetto-menu.json` (17 categorías, 65 productos) | `banetto` | `dueno@banetto.com` / `banetto1234` (DUENO) |
| Envases Reynoso | `npm run seed:reynoso` | `prisma/data/seed-reynoso-catalogo.json` (5 categorías, 22 productos), `facturacionModo: "OPCIONAL"`, 2 puntos de envío (`pedidoMinimo` $3000 y $4500) y equipo con los 3 roles | `envases-reynoso` | `dueno@reynoso.com` / `gerente@reynoso.com` / `operador@reynoso.com`, contraseñas `{rol}1234` |
| Banetto Mayoreo (B2B) | `npm run seed:banetto-mayoreo` | `prisma/data/seed-banetto-mayoreo-menu.json`; réplica del catálogo y la configuración B2B (mínimo de piezas, modo de cobro, ventana de recepción); crea clientes por alta y un Gerente de prueba (`gerente@banetto-mayorista.com`, contraseña en el JSON); deja el mínimo de piezas en 0 | `banetto-mayorista` | ver el JSON |
| Dominique Ansel (B2B demo) | `npm run seed:dominique-ansel` | `prisma/data/seed-dominique-ansel-menu.json`; storefront de mayoreo de demo con clientes por alta | slug en el JSON | ver el JSON |
| Hotel de prueba | `npx tsx prisma/seed-hotel-demo.ts` (no tiene script npm) | Idempotente; **solo para prueba local**: un tenant `HOTEL` para probar el panel y `POST /internal/reservas/amenitiz` | `hotel-demo` (`giroNegocio` `HOTEL`, horario vacío) | `dueno@hotel-demo.com` / `hotel1234`; `X-Api-Key`: `hotel-demo-api-key-local` |

Los seeds de Banetto (menudeo) y Reynoso no tocan `pizzeria-demo` ni se ejecutan como parte del seed principal.

**Notas de los seeds de menudeo**
- El seed de Banetto fue también la razón por la que se agregó el `<img>` de `fotoUrl` a las tarjetas de producto del storefront; si `fotoUrl` es `null` (un par de bebidas) no se renderiza `<img>`, sin ícono roto.
- Dos productos de Banetto (`Croissant de chocolate`, con foto; `Kombucha`, sin foto) se marcaron a mano `disponible = false` directo en la base (no viene del JSON) para tener datos reales del badge "Sin existencia" en ambos casos.
- En un seed real de Banetto en producción, incluir `LEALTAD` y `CODIGOS_DESCUENTO` en `modulosDesactivados`.
- **No reintroducir placeholders de cliente tipo `"Cliente Pendiente"`/`"Cliente Surtiendo"`/`"Cliente Despachado"`** en pedidos de ejemplo: `clienteNombre` se fija una sola vez y no sigue al estatus, así que al avanzar el pedido a mano el nombre quedaba describiendo un estatus viejo. Los pedidos de ejemplo de `seed.ts` usan nombres reales de ficción (`Ana Torres`, `Carlos Ramírez`, `Lucía Fernández`).
- El seed puntual de Karmele (`backend/scripts/karmele/`) está sin seguimiento en git y no forma parte del repo.

## Scripts de corrección y migración de datos

Código en `backend/src/scripts/`; guías en `backend/scripts/<tema>/`. **Todos hacen dry-run por defecto** y exigen una bandera explícita (`--aplicar`) para escribir. Nunca se corren contra staging o producción sin haber revisado el dry-run.

| Tema | Script | Guía | Para qué |
|---|---|---|---|
| Etapa 1 (`DetalleB2C`) | `backend/scripts/etapa1/` (verificador SQL/runner, volcado de staging saneado) | `scripts/etapa1/README.md` | Verificar la migración de columnas B2C a `DetalleB2C`; acepta `--hasta <fecha ISO>` |
| Etapa 2 (B2B → `Order`) | `src/scripts/etapa2-b2b.ts` | `scripts/etapa2/MIGRACION.md`; `scripts/etapa2/README.md` (datos B2B de prueba en staging, Etapa 0c) | Migrar `PedidoB2b` a `Order` + detalle/entregas (dry-run con ensayo, `--aplicar`, `auditar`, `revertir`) |
| Estados B2B | `src/scripts/b2b-estados.ts` (núcleo en `src/scripts/b2b-estados/`) | `scripts/b2b-estados/MIGRACION.md` | Datos de la migración de estados por entrega (`EN_PROCESO`, `COMPLETADO`, `NO_RECOGIDA`): normaliza el estado heredado `DESPACHADO` en pedidos B2B; idempotente, con reversa |
| Contadores de `Cliente` | `src/scripts/corregir-contadores.ts` | `scripts/contadores/README.md` | Recalcular `totalPedidos` / `primerPedidoAt` / `ultimoPedidoAt`; ver stripe-pagos.md |
| Modalidades de cobro B2B | `src/scripts/modalidades-cobro-b2b.ts` | `scripts/modalidades-cobro/README.md` | Por negocio de mayoreo: deja activa solo la modalidad de su `pedidoB2bModoCobro` actual (sin pisar negocios ya configurados en Ajustes → Pagos) y asigna esa modalidad a los clientes con `modalidadPago = NULL`; **el backend endurecido solo funciona bien después de correrla** (el README tiene el orden de despliegue) |
| Limpieza de pruebas B2B | `src/scripts/limpiar-b2b-prueba.ts` | — | Borrar datos B2B de prueba (dry-run por defecto) |
| Cliente de prueba del portal | `src/scripts/portal-cliente-prueba.ts` | — | Deja un teléfono como principal de UN cliente activo de un negocio (para probar el acceso al portal) |

## Railway: el enlace de la CLI es por directorio

`railway status` / `railway ssh` usan el proyecto enlazado en el directorio actual; desde `backend/` puede ser **producción**. Pasa siempre `-p <project> -e <environment>` y verifica el dominio. Ver `backend/scripts/etapa1/README.md` para la tabla de proyectos/ambientes.
