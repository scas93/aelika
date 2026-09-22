import { ConflictException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ClientesService } from '../clientes/clientes.service';
import { WalletPassService, DatosPaseInput, WalletPassResultado } from './wallet-pass.service';
import { generateApiKey } from '../common/api-key';
import { fechaEnMexico } from '../common/horario';
import { Cliente, LoyaltyCard, LoyaltyCardEstado } from '../../generated/prisma/client';
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
   * Alta sin PIN (ver LealtadController) — busca/crea el Cliente vía
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
   * Registrar compra — protegido por PIN a nivel de ruta (LealtadPinGuard),
   * esta capa solo conoce el token de la tarjeta. Check + create del
   * LoyaltyVisit + incremento del contador corren en una sola transacción
   * (this.tenantPrisma.client.$transaction) para cerrar la ventana de
   * condición de carrera entre el chequeo de "¿ya hay visita hoy?" y el
   * insert — el schema no tiene una constraint de DB que lo prevenga.
   */
  async registrarCompra(token: string) {
    const loyaltyCard = await this.buscarPorToken(token);

    if (loyaltyCard.estado === LoyaltyCardEstado.PREMIO_DISPONIBLE) {
      throw lealtadConflict(
        'Esta tarjeta ya tiene un premio disponible — hay que redimirlo antes de seguir sellando.',
        LealtadErrorCode.PREMIO_PENDIENTE,
      );
    }

    const hoy = fechaEnMexico();
    const ultimaVisita = await this.tenantPrisma.client.loyaltyVisit.findFirst({
      where: { loyaltyCardId: loyaltyCard.id },
      orderBy: { createdAt: 'desc' },
    });
    if (ultimaVisita && fechaEnMexico(ultimaVisita.createdAt) === hoy) {
      throw lealtadConflict(
        'Esta tarjeta ya registró un sello el día de hoy — máximo 1 sello por día.',
        LealtadErrorCode.SELLO_YA_REGISTRADO_HOY,
      );
    }

    let actualizada = await this.tenantPrisma.client.$transaction(async (tx) => {
      await tx.loyaltyVisit.create({
        data: { loyaltyCardId: loyaltyCard.id } as any,
      });

      const nuevoContador = loyaltyCard.contador + 1;
      const nuevoEstado =
        nuevoContador >= SELLOS_PARA_PREMIO
          ? LoyaltyCardEstado.PREMIO_DISPONIBLE
          : LoyaltyCardEstado.EN_PROGRESO;

      return tx.loyaltyCard.update({
        where: { id: loyaltyCard.id },
        data: { contador: nuevoContador, estado: nuevoEstado },
      });
    });

    const { loyaltyCard: conPaseActualizado, pase } = await this.actualizarPaseYPersistir(actualizada);
    return { loyaltyCard: conPaseActualizado, pase };
  }

  /** Redimir premio — protegido por PIN a nivel de ruta, mismo criterio que registrarCompra. */
  async redimirPremio(token: string) {
    const loyaltyCard = await this.buscarPorToken(token);

    if (loyaltyCard.estado !== LoyaltyCardEstado.PREMIO_DISPONIBLE) {
      throw new ConflictException('Esta tarjeta no tiene ningún premio disponible para redimir.');
    }

    const actualizada = await this.tenantPrisma.client.$transaction(async (tx) => {
      await tx.loyaltyRedemption.create({
        data: { loyaltyCardId: loyaltyCard.id } as any,
      });

      return tx.loyaltyCard.update({
        where: { id: loyaltyCard.id },
        data: { contador: 0, estado: LoyaltyCardEstado.EN_PROGRESO },
      });
    });

    const { loyaltyCard: conPaseActualizado, pase } = await this.actualizarPaseYPersistir(actualizada);
    return { loyaltyCard: conPaseActualizado, pase };
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
   * Tenant (nombre/slug/logo) vía this.tenantPrisma (mismo patrón que
   * OrdersService.avanzar, que también hace un findUnique de Tenant
   * cuando necesita su nombre) y Cliente (nombre), salvo que ya se tenga a
   * la mano (altaCliente ya trae el Cliente resuelto, no hace falta
   * refetchearlo).
   */
  private async construirDatosPase(
    loyaltyCard: LoyaltyCard,
    clienteConocido?: Cliente,
  ): Promise<DatosPaseInput> {
    const [tenant, cliente] = await Promise.all([
      this.tenantPrisma.client.tenant.findUniqueOrThrow({
        where: { id: loyaltyCard.tenantId },
        select: { nombre: true, slug: true, logoUrl: true },
      }),
      clienteConocido
        ? Promise.resolve(clienteConocido)
        : this.tenantPrisma.client.cliente.findUniqueOrThrow({
            where: { id: loyaltyCard.clienteId },
          }),
    ]);

    return {
      loyaltyCard,
      clienteNombre: cliente.nombre,
      tenantNombre: tenant.nombre,
      tenantLogoUrl: tenant.logoUrl,
      tenantSlug: tenant.slug,
    };
  }
}
