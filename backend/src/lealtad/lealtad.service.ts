import { ConflictException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ClientesService } from '../clientes/clientes.service';
import { WalletPassService, DatosPaseInput, WalletPassResultado } from './wallet-pass.service';
import { generateApiKey } from '../common/api-key';
import { fechaEnMexico } from '../common/horario';
import { Cliente, LoyaltyCard, LoyaltyCardEstado, Prisma } from '../../generated/prisma/client';
import { LealtadErrorCode, lealtadConflict, lealtadNotFound } from './lealtad-errors';

const SELLOS_PARA_PREMIO = 10;

@Injectable()
export class LealtadService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly clientesService: ClientesService,
    private readonly walletPassService: WalletPassService,
  ) {}

  /**
   * Alta de cliente — busca/crea el Cliente vía
   * ClientesService.buscarOCrearParaLealtad y, si ese Cliente todavía no
   * tiene tarjeta, crea una. Idempotente por diseño: una segunda alta con
   * el mismo teléfono siempre resuelve al mismo Cliente (unique
   * [tenantId, canal, telefono]) y por lo tanto a la misma LoyaltyCard
   * (relación 1:1, clienteId @unique) — nunca duplica.
   *
   * `crearPase` se llama si `serialNumber` sigue null — no "si el
   * LoyaltyCard es nuevo": esa es la condición real que cubre tanto el
   * alta nueva como un reintento de alta sobre una tarjeta que ya existía
   * pero cuya creación de pase falló la vez anterior (ver
   * WalletPassService.crearPase). Si el LoyaltyCard ya tiene un pase
   * (serialNumber no nulo), NO se vuelve a crear — se llama a
   * `actualizarPase` (PUT, con el contador actual, sin incrementarlo ni
   * crear un `LoyaltyVisit`) solo para conseguir un `shareUrl` fresco que
   * reenviarle a un cliente que perdió su link. Best-effort, igual que
   * cualquier otro uso de `actualizarPase` (ver actualizarPaseYPersistir):
   * un fallo de WalletWallet aquí no rompe la respuesta del endpoint,
   * solo regresa `pase: null`.
   */
  async altaCliente(nombre: string, telefono: string) {
    const cliente = await this.clientesService.buscarOCrearParaLealtad(nombre, telefono);

    let loyaltyCard = await this.tenantPrisma.client.loyaltyCard.findUnique({
      where: { clienteId: cliente.id },
    });

    if (!loyaltyCard) {
      loyaltyCard = await this.tenantPrisma.client.loyaltyCard.create({
        data: {
          clienteId: cliente.id,
          // Misma función que genera Tenant.botApiKey (crypto.randomBytes,
          // no uuid()) — es, en sí mismo, la credencial codificada en el QR
          // personal, no un identificador de fila. Ver common/api-key.ts.
          token: generateApiKey(),
        } as any,
      });
    }

    if (loyaltyCard.serialNumber) {
      const { loyaltyCard: conPaseActualizado, pase } = await this.actualizarPaseYPersistir(loyaltyCard);
      return { loyaltyCard: conPaseActualizado, pase };
    }

    const datosPase = await this.construirDatosPase(loyaltyCard, cliente);
    const pase = await this.walletPassService.crearPase(datosPase);

    loyaltyCard = await this.tenantPrisma.client.loyaltyCard.update({
      where: { id: loyaltyCard.id },
      data: { serialNumber: pase.serialNumber },
    });

    return { loyaltyCard, pase };
  }

  /**
   * Registrar compra. Todo lo que decide si el sello procede (estado de la
   * tarjeta, "¿ya hay visita hoy?") y el cálculo del contador nuevo corren
   * DENTRO de la misma transacción que el insert del LoyaltyVisit, después
   * de tomar un lock de fila sobre la tarjeta (ver bloquearTarjeta). Dos
   * escaneos simultáneos de la misma tarjeta se serializan: el segundo
   * espera a que el primero haga commit y entonces ya ve su visita de hoy
   * (409 SELLO_YA_REGISTRADO_HOY) o su PREMIO_DISPONIBLE (409
   * PREMIO_PENDIENTE), en vez de leer ambos el mismo estado viejo. El schema
   * no tiene una constraint de DB para "1 sello por día" — el lock es lo que
   * la garantiza.
   */
  async registrarCompra(token: string) {
    const tarjeta = await this.buscarPorToken(token);
    const loyaltyCardId = tarjeta.id;

    const actualizada = await this.tenantPrisma.client.$transaction(async (tx) => {
      const loyaltyCard = await this.bloquearTarjeta(tx, tarjeta);

      if (loyaltyCard.estado === LoyaltyCardEstado.PREMIO_DISPONIBLE) {
        throw lealtadConflict(
          'Esta tarjeta ya tiene un premio disponible — hay que redimirlo antes de seguir sellando.',
          LealtadErrorCode.PREMIO_PENDIENTE,
        );
      }

      const ultimaVisita = await tx.loyaltyVisit.findFirst({
        where: { loyaltyCardId },
        orderBy: { createdAt: 'desc' },
      });
      if (ultimaVisita && fechaEnMexico(ultimaVisita.createdAt) === fechaEnMexico()) {
        throw lealtadConflict(
          'Esta tarjeta ya registró un sello el día de hoy — máximo 1 sello por día.',
          LealtadErrorCode.SELLO_YA_REGISTRADO_HOY,
        );
      }

      await tx.loyaltyVisit.create({
        data: { loyaltyCardId } as any,
      });

      // Seguro leer-y-sumar aquí (en vez de `increment`): la fila está
      // bloqueada desde bloquearTarjeta, nadie más puede cambiar `contador`
      // hasta el commit, y el estado nuevo depende del valor resultante.
      const nuevoContador = loyaltyCard.contador + 1;
      const nuevoEstado =
        nuevoContador >= SELLOS_PARA_PREMIO
          ? LoyaltyCardEstado.PREMIO_DISPONIBLE
          : LoyaltyCardEstado.EN_PROGRESO;

      return tx.loyaltyCard.update({
        where: { id: loyaltyCardId },
        data: { contador: nuevoContador, estado: nuevoEstado },
      });
    });

    const { loyaltyCard: conPaseActualizado, pase } = await this.actualizarPaseYPersistir(actualizada);
    return { loyaltyCard: conPaseActualizado, pase };
  }

  /**
   * Redimir premio — mismo lock de fila que registrarCompra, así un canje y
   * un sello simultáneos (o dos canjes) de la misma tarjeta nunca se
   * intercalan: un segundo canje concurrente ve la tarjeta ya en EN_PROGRESO
   * y da 409 en vez de crear un LoyaltyRedemption duplicado.
   */
  async redimirPremio(token: string) {
    const tarjeta = await this.buscarPorToken(token);
    const loyaltyCardId = tarjeta.id;

    const actualizada = await this.tenantPrisma.client.$transaction(async (tx) => {
      const loyaltyCard = await this.bloquearTarjeta(tx, tarjeta);

      if (loyaltyCard.estado !== LoyaltyCardEstado.PREMIO_DISPONIBLE) {
        throw new ConflictException('Esta tarjeta no tiene ningún premio disponible para redimir.');
      }

      await tx.loyaltyRedemption.create({
        data: { loyaltyCardId } as any,
      });

      return tx.loyaltyCard.update({
        where: { id: loyaltyCardId },
        data: { contador: 0, estado: LoyaltyCardEstado.EN_PROGRESO },
      });
    });

    const { loyaltyCard: conPaseActualizado, pase } = await this.actualizarPaseYPersistir(actualizada);
    return { loyaltyCard: conPaseActualizado, pase };
  }

  /**
   * `SELECT ... FOR UPDATE` sobre la fila de la tarjeta, dentro de la
   * transacción recibida, y luego relee la tarjeta ya con el lock tomado —
   * en READ COMMITTED (default de Postgres) cada statement ve lo último
   * committeado, así que esta lectura refleja cualquier sello/canje que
   * otra transacción haya hecho mientras esperábamos el lock. El lock se
   * libera solo al commit/rollback.
   *
   * `$queryRaw` no pasa por la extensión tenantScopedQuery de
   * TenantPrismaService, por eso el `tenantId` va explícito en el WHERE
   * (mismo principio que PrismaService crudo en los endpoints públicos). En
   * la práctica id/tenantId vienen de buscarPorToken, que sí está
   * tenant-scoped.
   */
  private async bloquearTarjeta(
    tx: Prisma.TransactionClient,
    tarjeta: Pick<LoyaltyCard, 'id' | 'tenantId'>,
  ): Promise<LoyaltyCard> {
    await tx.$queryRaw`SELECT "id" FROM "loyalty_cards" WHERE "id" = ${tarjeta.id} AND "tenantId" = ${tarjeta.tenantId} FOR UPDATE`;
    return tx.loyaltyCard.findUniqueOrThrow({ where: { id: tarjeta.id } });
  }

  /**
   * Llama a WalletPassService.actualizarPase (nunca tira excepción, ver ese
   * método) y, si regresó un resultado (éxito normal o vía auto-sanación),
   * persiste el `serialNumber` — puede ser el mismo de siempre o uno nuevo
   * si la auto-sanación tuvo que crear el pase desde cero. Si regresó
   * `null` (falla de red/API), la LoyaltyCard ya actualizada por la
   * transacción de negocio se regresa tal cual, sin tocarla de nuevo.
   */
  private async actualizarPaseYPersistir(
    loyaltyCard: LoyaltyCard,
  ): Promise<{ loyaltyCard: LoyaltyCard; pase: WalletPassResultado | null }> {
    const datosPase = await this.construirDatosPase(loyaltyCard);
    const pase = await this.walletPassService.actualizarPase(datosPase);

    if (!pase || pase.serialNumber === loyaltyCard.serialNumber) {
      return { loyaltyCard, pase };
    }

    const actualizada = await this.tenantPrisma.client.loyaltyCard.update({
      where: { id: loyaltyCard.id },
      data: { serialNumber: pase.serialNumber },
    });
    return { loyaltyCard: actualizada, pase };
  }

  private async buscarPorToken(token: string): Promise<LoyaltyCard> {
    const loyaltyCard = await this.tenantPrisma.client.loyaltyCard.findFirst({
      where: { token },
    });
    if (!loyaltyCard) {
      throw lealtadNotFound(
        'No se encontró ninguna tarjeta de lealtad con ese código.',
        LealtadErrorCode.TOKEN_NO_ENCONTRADO,
      );
    }
    return loyaltyCard;
  }

  /**
   * Junta lo que WalletPassService necesita para armar el body del pase —
   * Tenant (nombre) vía this.tenantPrisma (mismo patrón que
   * OrdersService.avanzar, que también hace un findUnique de Tenant
   * cuando necesita su nombre), Cliente (nombre), salvo que ya se tenga a
   * la mano (altaCliente ya trae el Cliente resuelto, no hace falta
   * refetchearlo), y si esta tarjeta ya canjeó algún premio alguna vez
   * (ver DatosPaseInput.yaCanjeoPremio — es lo único que
   * calcularMensajeNotificacion necesita saber además del contador, que ya
   * viene en loyaltyCard).
   */
  private async construirDatosPase(
    loyaltyCard: LoyaltyCard,
    clienteConocido?: Cliente,
  ): Promise<DatosPaseInput> {
    const [tenant, cliente, redenciones] = await Promise.all([
      this.tenantPrisma.client.tenant.findUniqueOrThrow({
        where: { id: loyaltyCard.tenantId },
        select: { nombre: true },
      }),
      clienteConocido
        ? Promise.resolve(clienteConocido)
        : this.tenantPrisma.client.cliente.findUniqueOrThrow({
            where: { id: loyaltyCard.clienteId },
          }),
      this.tenantPrisma.client.loyaltyRedemption.count({
        where: { loyaltyCardId: loyaltyCard.id },
      }),
    ]);

    return {
      loyaltyCard,
      clienteNombre: cliente.nombre,
      tenantNombre: tenant.nombre,
      yaCanjeoPremio: redenciones > 0,
    };
  }
}
