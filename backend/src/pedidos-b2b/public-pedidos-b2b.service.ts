import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { moduloActivo } from '../common/modulos';
import {
  estaEnVentana,
  mensajeVentanaCerrada,
  ventanaDesdeTenant,
} from '../common/ventana-recepcion-b2b';
import {
  calcularSemanaDestino,
  resolverCodigoDescuento,
} from './pedidos-b2b-logica';

export const MENSAJE_PEDIDOS_EN_LINEA_CERRADOS =
  'Los pedidos en línea de mayoreo se habilitan con tu cuenta de cliente. Contáctanos.';

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
        pedidoB2bVentanaAperturaDia: true,
        pedidoB2bVentanaAperturaHora: true,
        pedidoB2bVentanaCierreDia: true,
        pedidoB2bVentanaCierreHora: true,
        facturacionModo: true,
        modulosDesactivados: true,
      },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const ventana = ventanaDesdeTenant(tenant);
    const abierto = estaEnVentana(ventana);
    return {
      nombre: tenant.nombre,
      logoUrl: tenant.logoUrl,
      pedidoB2bModoCobro: tenant.pedidoB2bModoCobro,
      pedidoB2bMinimoPiezas: tenant.pedidoB2bMinimoPiezas,
      // A diferencia de PublicService.getTenantInfo (B2C, que usa
      // isAbiertoAhora/HorarioSemana), este storefront gatea el checkout con
      // su propia ventana de recepción — ver Tenant.pedidoB2bVentana* y
      // common/ventana-recepcion-b2b.ts. Sin ventana configurada, estaEnVentana
      // regresa true (siempre abierta). createPedido vuelve a revisarlo
      // server-side, este flag es solo para no mostrar el paso de checkout
      // de entrada.
      abierto,
      // Mismo texto que vería el cliente si forzara el envío mientras está
      // cerrado (ver el 409 de createPedido más abajo) — null cuando abierto
      // es true. Expuesto aquí para que el storefront pueda bloquear el
      // catálogo de entrada (no solo el paso de checkout) con el mismo
      // mensaje de "cuándo reabre", sin necesitar un segundo viaje al
      // servidor vía un intento de creación condenado a fallar.
      ventanaCerradaMensaje: abierto ? null : mensajeVentanaCerrada(ventana!),
      // Mismo propósito que en PublicService.getTenantInfo: para que el
      // storefront decida, sin una segunda llamada, si mostrar/exigir los
      // campos de factura — resolverFacturacion en createPedido vuelve a
      // exigirlo server-side.
      facturacionModo: tenant.facturacionModo,
      // Si es false el storefront no muestra el campo de código de descuento (módulo apagado para el negocio).
      codigosDescuentoActivo: moduloActivo(
        tenant.modulosDesactivados,
        'CODIGOS_DESCUENTO',
      ),
      // Semana calendario a la que aplicará el pedido que se está armando —
      // ver calcularSemanaDestino. El frontend todavía no la consume (sigue
      // calculando su propio "próximo lunes" en pedido-flow.tsx); queda
      // expuesta aquí para que una fase posterior deje de recalcularla.
      semanaDestino: calcularSemanaDestino(),
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

  /**
   * El storefront anónimo de mayoreo ya no crea pedidos: un pedido B2B pertenece a un cliente dado de alta por un
   * admin (docs/diseno-operacion.md, "Clientes y acceso"), y aquí no hay a quién atribuirlo. Se habilita con el portal
   * con cuenta (Fase 4); mientras, el equipo captura desde el panel. Slug inexistente: el mismo 404 de siempre.
   */
  async rechazarPedidoAnonimo(slug: string): Promise<never> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }
    throw new ConflictException(MENSAJE_PEDIDOS_EN_LINEA_CERRADOS);
  }
}
