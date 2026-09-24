import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientesService } from '../clientes/clientes.service';
import { WalletPassService, DatosPaseInput, WalletPassResultado } from './wallet-pass.service';
import { generateApiKey } from '../common/api-key';
import { Cliente, LoyaltyCard } from '../../generated/prisma/client';

/**
 * Storefront público de Lealtad — sin JWT, mismo patrón que
 * PublicPedidosB2bService (pedidos-b2b/): tenant resuelto por slug con
 * PrismaService crudo (nunca TenantPrismaService, que depende de sesión),
 * tenantId explícito en cada query. Deliberadamente separado de
 * LealtadService (que sí depende de TenantPrismaService y truena sin
 * sesión) — comparten WalletPassService (sin dependencia de sesión) y
 * ClientesService (vía su variante explícita-por-tenantId, ver
 * buscarOCrearParaLealtadPublico), no el acceso a datos de LoyaltyCard/Tenant.
 *
 * Porta las 3 ramas de LealtadService.altaCliente (ver ese método): cliente
 * nuevo, tarjeta existente sin pase (reintento) y tarjeta existente con
 * pase (solo refresca shareUrl) — la tercera es la que garantiza que un
 * mismo teléfono que vuelve a esta página pública reciba su link de nuevo
 * en vez de un error o una tarjeta duplicada.
 */
@Injectable()
export class PublicLealtadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientesService: ClientesService,
    private readonly walletPassService: WalletPassService,
  ) {}

  async altaCliente(slug: string, nombre: string, telefono: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, nombre: true },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const cliente = await this.clientesService.buscarOCrearParaLealtadPublico(this.prisma, tenant.id, nombre, telefono);

    let loyaltyCard = await this.prisma.loyaltyCard.findUnique({
      where: { clienteId: cliente.id },
    });

    if (!loyaltyCard) {
      loyaltyCard = await this.prisma.loyaltyCard.create({
        data: {
          tenantId: tenant.id,
          clienteId: cliente.id,
          token: generateApiKey(),
        },
      });
    }

    if (loyaltyCard.serialNumber) {
      const { loyaltyCard: conPaseActualizado, pase } = await this.actualizarPaseYPersistir(loyaltyCard, cliente, tenant);
      return { loyaltyCard: conPaseActualizado, pase };
    }

    const datosPase = await this.construirDatosPase(loyaltyCard, cliente, tenant);
    const pase = await this.walletPassService.crearPase(datosPase);

    loyaltyCard = await this.prisma.loyaltyCard.update({
      where: { id: loyaltyCard.id },
      data: { serialNumber: pase.serialNumber },
    });

    return { loyaltyCard, pase };
  }

  /**
   * Mismo criterio que LealtadService.actualizarPaseYPersistir: nunca tira
   * excepción (ver WalletPassService.actualizarPase) — si WalletWallet falla,
   * la LoyaltyCard ya resuelta se regresa tal cual, con pase: null.
   */
  private async actualizarPaseYPersistir(
    loyaltyCard: LoyaltyCard,
    cliente: Cliente,
    tenant: { id: string; nombre: string },
  ): Promise<{ loyaltyCard: LoyaltyCard; pase: WalletPassResultado | null }> {
    const datosPase = await this.construirDatosPase(loyaltyCard, cliente, tenant);
    const pase = await this.walletPassService.actualizarPase(datosPase);

    if (!pase || pase.serialNumber === loyaltyCard.serialNumber) {
      return { loyaltyCard, pase };
    }

    const actualizada = await this.prisma.loyaltyCard.update({
      where: { id: loyaltyCard.id },
      data: { serialNumber: pase.serialNumber },
    });
    return { loyaltyCard: actualizada, pase };
  }

  // A diferencia de LealtadService.construirDatosPase (que a veces necesita
  // refetchear tenant/cliente porque solo recibe el token de la tarjeta),
  // tenant/cliente ya están resueltos siempre aquí — altaCliente los tiene a
  // la mano desde el inicio (tenant por slug, cliente recién buscado/creado).
  // Sí necesita seguir siendo async: yaCanjeoPremio (ver DatosPaseInput) es
  // la única pieza que no viene ya resuelta, hay que consultarla.
  private async construirDatosPase(
    loyaltyCard: LoyaltyCard,
    cliente: Cliente,
    tenant: { nombre: string },
  ): Promise<DatosPaseInput> {
    const redenciones = await this.prisma.loyaltyRedemption.count({
      where: { loyaltyCardId: loyaltyCard.id },
    });

    return {
      loyaltyCard,
      clienteNombre: cliente.nombre,
      tenantNombre: tenant.nombre,
      yaCanjeoPremio: redenciones > 0,
    };
  }
}
