import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../common/money';
import { isAbiertoAhora, HorarioSemana } from '../common/horario';
import { resolverFacturacion } from '../common/facturacion';
import { CreatePedidoB2bDto } from './dto/create-pedido-b2b.dto';
import {
  assertLunes,
  crearItems,
  nextFolioPedidoB2b,
  resolverCodigoDescuento,
  resolverItems,
} from './pedidos-b2b-logica';

/**
 * Storefront público del módulo B2B — sin JWT, mismo patrón que
 * PublicService (public/): tenant resuelto por slug con PrismaService
 * crudo (nunca TenantPrismaService, que depende de sesión), tenantId
 * explícito en cada query. Deliberadamente separado de PedidosB2bService
 * (que sí depende de TenantPrismaService y truena sin sesión) — comparten
 * la lógica de negocio vía pedidos-b2b-logica.ts, no el acceso a datos.
 *
 * Alcance de esta fase: solo modoCobro = AL_FINAL (crédito). Un tenant en
 * AL_INICIO (pago con tarjeta al confirmar) no tiene ese flujo construido
 * todavía aquí — createPedido lo rechaza con 409 en vez de crear un pedido
 * que nunca podría cobrarse por esta vía.
 */
@Injectable()
export class PublicPedidosB2bService {
  constructor(private readonly prisma: PrismaService) {}

  async getTenantInfo(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        nombre: true,
        logoUrl: true,
        pedidoB2bModoCobro: true,
        pedidoB2bMinimoPiezas: true,
        horarioAtencion: true,
        facturacionModo: true,
      },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const horario = tenant.horarioAtencion as HorarioSemana | null;
    return {
      nombre: tenant.nombre,
      logoUrl: tenant.logoUrl,
      pedidoB2bModoCobro: tenant.pedidoB2bModoCobro,
      pedidoB2bMinimoPiezas: tenant.pedidoB2bMinimoPiezas,
      // Mismo mecanismo que PublicService.getTenantInfo (B2C): el storefront
      // usa esto para bloquear el flujo de checkout mientras el negocio está
      // cerrado — createPedido vuelve a revisarlo server-side, este flag es
      // solo para no mostrar el paso de checkout de entrada.
      abierto: isAbiertoAhora(horario),
      // Mismo propósito que en PublicService.getTenantInfo: para que el
      // storefront decida, sin una segunda llamada, si mostrar/exigir los
      // campos de factura — resolverFacturacion en createPedido vuelve a
      // exigirlo server-side.
      facturacionModo: tenant.facturacionModo,
    };
  }

  async getCatalog(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    // A diferencia del catálogo B2C (PublicService.getCatalog), este no trae
    // modifierGroups ni promotions — el módulo B2B no tiene modificadores, y
    // su descuento es por código de texto (PedidoB2bCodigoDescuento), no
    // Promotion. Solo productos disponibles: a diferencia del storefront de
    // pickup (que muestra agotados con badge porque el stock cambia
    // hora a hora), este es un pedido de abasto semanal a futuro — no tiene
    // sentido ofrecer algo no disponible para armar la semana.
    const categories = await this.prisma.category.findMany({
      where: { tenantId: tenant.id, activa: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      select: {
        id: true,
        nombre: true,
        products: {
          where: { tenantId: tenant.id, disponible: true },
          orderBy: { nombre: 'asc' },
          select: {
            id: true,
            nombre: true,
            descripcion: true,
            precio: true,
            fotoUrl: true,
            disponible: true,
          },
        },
      },
    });

    return { categories };
  }

  /**
   * Preview de un código de descuento — no lista códigos (no hay endpoint de
   * enumeración pública), solo resuelve uno exacto por texto, igual que
   * createPedido. Permite al storefront mostrar el % antes de confirmar,
   * pero el pedido en sí siempre vuelve a resolver el código server-side al
   * crearse — nunca confía en el porcentaje que el cliente ya vio.
   */
  async previewCodigoDescuento(slug: string, codigo: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const { descuentoPorcentajeAplicado } = await resolverCodigoDescuento(
      this.prisma,
      tenant.id,
      codigo,
      0,
    );
    return { descuentoPorcentaje: descuentoPorcentajeAplicado };
  }

  async createPedido(slug: string, dto: CreatePedidoB2bDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        pedidoB2bModoCobro: true,
        pedidoB2bMinimoPiezas: true,
        horarioAtencion: true,
        facturacionModo: true,
      },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    // Cerrado ahora mismo? Mismo chequeo que PublicService.createOrder (B2C)
    // — no puede depender de que el "abierto" que ya vio el cliente siga
    // vigente, se revisa server-side sin importar lo que haya mostrado el
    // frontend.
    const horario = tenant.horarioAtencion as HorarioSemana | null;
    if (!isAbiertoAhora(horario)) {
      throw new ConflictException('El negocio está cerrado en este momento');
    }

    // Fuera de alcance de esta fase — ver comentario de clase. El pedido
    // nunca se crea para no dejar un registro que jamás podría cobrarse
    // por este storefront.
    if (tenant.pedidoB2bModoCobro === 'AL_INICIO') {
      throw new ConflictException(
        'Este negocio requiere pago con tarjeta al confirmar el pedido — ese flujo aún no está disponible en este storefront. Contacta directamente al negocio.',
      );
    }

    // Facturación — mismo mecanismo que PublicService.createOrder (B2C), ver
    // common/facturacion.ts. Este módulo no timbra CFDI real, solo captura
    // los datos fiscales para que el negocio facture por fuera del sistema.
    const factura = resolverFacturacion(tenant.facturacionModo, dto);

    const semanaInicio = assertLunes(dto.semanaInicio);
    const { resueltos, totalPiezas, subtotal } = await resolverItems(
      this.prisma,
      tenant.id,
      dto.items,
    );
    const {
      codigoDescuentoId,
      codigoDescuentoTexto,
      descuentoPorcentajeAplicado,
      descuentoTotal,
    } = await resolverCodigoDescuento(
      this.prisma,
      tenant.id,
      dto.codigoDescuento,
      subtotal,
    );

    const total = round2(subtotal - descuentoTotal);

    return this.prisma.$transaction(async (tx) => {
      const folio = await nextFolioPedidoB2b(tx, tenant.id);

      const pedido = await tx.pedidoB2b.create({
        data: {
          tenantId: tenant.id,
          folio,
          negocioNombre: dto.negocioNombre,
          contactoNombre: dto.contactoNombre,
          contactoTelefono: dto.contactoTelefono,
          contactoCorreo: dto.contactoCorreo,
          semanaInicio,
          // Siempre AL_FINAL en este punto — AL_INICIO ya se rechazó arriba.
          modoCobro: tenant.pedidoB2bModoCobro,
          minimoPiezasAplicado: tenant.pedidoB2bMinimoPiezas,
          totalPiezas,
          codigoDescuentoId,
          codigoDescuentoTexto,
          descuentoPorcentajeAplicado,
          subtotal,
          descuentoTotal,
          total,
          ...factura,
        },
      });

      await crearItems(tx, tenant.id, pedido.id, resueltos);

      return tx.pedidoB2b.findUniqueOrThrow({
        where: { id: pedido.id },
        include: { items: { include: { distribucion: true } } },
      });
    });
  }
}
