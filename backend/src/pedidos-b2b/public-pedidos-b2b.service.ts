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
import { calcularSemanaDestino } from './pedidos-b2b-logica';

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

  // getCatalog y previewCodigoDescuento se retiraron (Fase 4, 4d): el catálogo y los precios de mayoreo solo se ven con
  // sesión del portal (PortalCatalogoService) y el descuento es un % del cliente, no un código escrito en la tienda.

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
