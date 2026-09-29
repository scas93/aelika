# Suite de caracterización (Órdenes centralizadas, Etapa 0)

Congela el **contrato HTTP** actual de pedidos B2C para validar el refactor
(`Order` base + tablas de detalle). Corre la app de Nest completa por HTTP
(supertest) contra un Postgres real.

## Comando

```bash
npm run test:char                      # una corrida
npx jest --config ./test/characterization/jest.config.js --randomize   # orden aleatorio
```

Es independiente de `npm test` (unitario, `src/**/*.spec.ts`).

## Base de pruebas

- Base dedicada `<nombre-dev>_test` en el **mismo Postgres local** (contenedor
  `aelika-postgres`). Se deriva de `DATABASE_URL` en `backend/.env` cambiando
  solo el nombre de la base, o se fija con `TEST_DATABASE_URL`.
- **Guarda** (`db-guard.ts`): la suite se niega a correr si la base no termina
  en `_test` o el host no es local. Staging/producción nunca son base de tests.
- `global-setup.ts` crea la base si no existe y aplica las migraciones del repo
  (`prisma migrate deploy`). Cada test empieza con `TRUNCATE ... CASCADE`.
- Ejecución **en serie** (`maxWorkers: 1`): una sola base compartida.

## Sustitutos de servicios externos (`harness.ts`)

| Servicio | Cómo |
|---|---|
| Cola BullMQ de notificaciones | `queue.add` mock (`fakes.queueAdd`); el processor no corre |
| Stripe | cliente real (firma de webhook real) con `paymentIntents.create` y `refunds.create` mock |
| Reglas EVENTO_PEDIDO / Botpress | `dispararSeguro` mock; el barrido `@Cron` se anula |
| Redis (token de Telegram) | provider sustituido |

## Reloj

Solo se falsea `Date` (`freezeClock`); timers reales. Nota: Prisma genera
`createdAt`/`updatedAt` (`@default(now())`/`@updatedAt`) del lado del cliente,
así que **también** siguen el reloj falso.

## Fixtures

Solo tenant, usuarios, catálogo (y punto de envío) se insertan directo, en
`db.ts:seedBase`. Los pedidos se crean por `POST` de checkout.

## Fire-and-forget

Lo que termina después de la respuesta HTTP (`encolarPedidoRecibido`,
`dispararSeguro`, etc.) se espera con `waitForCalls(mock)`, sin `sleep`.
