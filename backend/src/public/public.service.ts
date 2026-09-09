import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { NotificacionesQueueService } from '../notificaciones/queue/notificaciones-queue.service';
import { ClientesService } from '../clientes/clientes.service';
import { horaActualMexico, horarioDeHoy, isAbiertoAhora, sumarMinutos, HorarioSemana } from '../common/horario';
import { resolverFacturacion } from '../common/facturacion';
import { round2 } from '../common/money';
import {
  CanalOrigen,
  ClienteCanal,
  EstadoPago,
  EstadoPedido,
  HoraRecogidaTipo,
  MetodoEntrega,
  MetodoPago,
  NotificacionEvento,
  Prisma,
  PromotionTipo,
  TipoSeleccion,
} from '../../generated/prisma/client';
import { CreatePublicOrderDto } from './dto/create-public-order.dto';
import type { DescuentoProductoConfigDto } from '../promotions/dto/descuento-producto-config.dto';
import type { ComboConfigDto } from '../promotions/dto/combo-config.dto';

// Order.direccion* — the customer's actual delivery address, distinct from
// PuntoEnvio.direccion (the zone's own fixed address). Required only when
// metodoEntrega = DOMICILIO; null for RECOGER — same shape/pattern as
// FacturaFields above.
interface DireccionFields {
  direccionCalle: string | null;
  direccionNumero: string | null;
  direccionColonia: string | null;
  direccionReferencias: string | null;
}

const DIRECCION_VACIA: DireccionFields = {
  direccionCalle: null,
  direccionNumero: null,
  direccionColonia: null,
  direccionReferencias: null,
};

// Pickup needs lead time for the kitchen — a specific pickup time can't be
// requested for right now or for a time that's already passed.
const MARGEN_MINIMO_MINUTOS = 15;

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly notificacionesQueueService: NotificacionesQueueService,
    private readonly clientesService: ClientesService,
  ) {}

  async getTenantInfo(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        nombre: true,
        logoUrl: true,
        horarioAtencion: true,
        ubicacion: true,
        facturacionModo: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
        tipoStorefront: true,
      },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const horario = tenant.horarioAtencion as HorarioSemana | null;
    return {
      nombre: tenant.nombre,
      logoUrl: tenant.logoUrl,
      tipoStorefront: tenant.tipoStorefront,
      horarioAtencion: horario,
      ubicacion: tenant.ubicacion,
      abierto: isAbiertoAhora(horario),
      // Exposed so the storefront checkout can decide, without a second
      // fetch, whether to show/require the factura fields — see
      // resolverFacturacion below for the same logic re-enforced server-side.
      facturacionModo: tenant.facturacionModo,
      // Whether metodoPago = TARJETA can be offered at checkout — mirrors the
      // same re-check createOrder does server-side (see step 3 below), so the
      // storefront never shows an option the server would 409 anyway.
      aceptaTarjeta: Boolean(tenant.stripeAccountId) && tenant.stripeChargesEnabled,
    };
  }

  async getCatalog(slug: string) {
    // Resolve the tenant from the slug first — everything below filters by
    // this resolved tenantId, never by a JWT (there isn't one on public
    // routes). Same isolation guarantee as the authenticated app, just with
    // the tenantId coming from the URL instead of the session.
    const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const [rawCategories, promotions] = await Promise.all([
      this.prisma.category.findMany({
        where: { tenantId: tenant.id, activa: true },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
        select: {
          id: true,
          nombre: true,
          products: {
            // No filtra por disponible: el storefront necesita mostrar los
            // productos agotados (badge "Sin existencia", sin botón de
            // agregar) en vez de ocultarlos por completo. La validación de
            // disponibilidad real sigue viviendo, sin cambios, en
            // createOrder más abajo — este query nunca alimenta el checkout.
            where: { tenantId: tenant.id },
            orderBy: { nombre: 'asc' },
            select: {
              id: true,
              nombre: true,
              descripcion: true,
              precio: true,
              fotoUrl: true,
              disponible: true,
              // ProductModifierGroup (join rows) filtradas por
              // modifierGroup.activo y ordenadas por `orden` — se aplanan a
              // ModifierGroup[] justo abajo, el join row en sí no le importa
              // al cliente.
              modifierGroups: {
                where: { modifierGroup: { activo: true } },
                orderBy: { orden: 'asc' },
                select: {
                  modifierGroup: {
                    select: {
                      id: true,
                      nombre: true,
                      tipoSeleccion: true,
                      obligatorio: true,
                      opciones: {
                        where: { activo: true },
                        select: { id: true, nombre: true, precioAdicional: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.promotion.findMany({
        where: { tenantId: tenant.id, activa: true },
        select: { id: true, tipo: true, config: true },
      }),
    ]);

    const categories = rawCategories.map((category) => ({
      ...category,
      products: category.products.map((product) => ({
        ...product,
        modifierGroups: product.modifierGroups.map((asignacion) => asignacion.modifierGroup),
      })),
    }));

    return { categories, promotions };
  }

  async getPuntosEnvio(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    // Only activo=true — an inactive point isn't offered to customers at
    // all, same rationale as resolverPuntoEnvio treating it as 404 below.
    return this.prisma.puntoEnvio.findMany({
      where: { tenantId: tenant.id, activo: true },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, direccion: true, pedidoMinimo: true },
    });
  }

  /**
   * Consulta pública de `estadoPago` — pensada para que el storefront (Fase
   * 2, frontend) haga polling mientras espera que el webhook de Stripe
   * confirme un pago con tarjeta. Filtra por slug+id igual que el resto de
   * este servicio (nunca por id solo) y solo expone `estadoPago` — nada del
   * resto del pedido (cliente, dirección, factura, total) — porque cualquier
   * cliente que conozca un `id` de pedido de otro tenant podría intentar
   * consultarlo aquí; el 404 por tenant equivocado es la misma protección
   * que ya usa el resto del PublicController, y el campo expuesto es
   * deliberadamente mínimo.
   */
  async getEstadoPago(slug: string, orderId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId: tenant.id },
      select: { estadoPago: true },
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return { estadoPago: order.estadoPago };
  }

  async createOrder(slug: string, dto: CreatePublicOrderDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        nombre: true,
        horarioAtencion: true,
        facturacionModo: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
      },
    });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const horario = tenant.horarioAtencion as HorarioSemana | null;

    // 1. Closed right now? This can't depend on the client's own "abierto"
    // banner staying in sync — re-check server-side no matter what the
    // frontend showed.
    if (!isAbiertoAhora(horario)) {
      throw new ConflictException('El negocio está cerrado en este momento');
    }

    // 2. Pickup time — meaningless for DOMICILIO orders (no time slot for
    // delivery yet), so horaRecogidaTipo/horaRecogida are ignored entirely
    // and forced to their RECOGER defaults whenever metodoEntrega = DOMICILIO,
    // no matter what the client sent for them.
    const metodoEntrega = dto.metodoEntrega ?? MetodoEntrega.RECOGER;
    let horaRecogidaTipo: HoraRecogidaTipo;
    let horaRecogida: string | null;
    if (metodoEntrega === MetodoEntrega.DOMICILIO) {
      horaRecogidaTipo = HoraRecogidaTipo.LO_ANTES_POSIBLE;
      horaRecogida = null;
    } else {
      if (!dto.horaRecogidaTipo) {
        throw new BadRequestException('horaRecogidaTipo es obligatorio');
      }
      horaRecogidaTipo = dto.horaRecogidaTipo;
      horaRecogida = this.resolverHoraRecogida(dto, horario);
    }

    // 3. Payment method. TARJETA requires a connected Stripe account with
    // card_payments actually active — same check exposed to the client as
    // `aceptaTarjeta` in getTenantInfo, re-enforced here since that's only a
    // UI hint. TRANSFERENCIA has no implementation at all yet.
    if (dto.metodoPago === MetodoPago.TRANSFERENCIA) {
      throw new ConflictException('Ese método de pago no está disponible todavía');
    }
    if (dto.metodoPago === MetodoPago.TARJETA && !(tenant.stripeAccountId && tenant.stripeChargesEnabled)) {
      throw new ConflictException('Este negocio no acepta pagos con tarjeta todavía');
    }

    // 4. Delivery method / punto de envío — structural checks only (existence,
    // ownership, activo). The pedidoMinimo check needs the calculated total,
    // so it happens later, right before the order is created.
    const puntoEnvio = await this.resolverPuntoEnvio(tenant.id, metodoEntrega, dto.puntoEnvioId);

    // 4b. Customer's delivery address — required only for DOMICILIO, same
    // convention as puntoEnvioId just above.
    const direccionEntrega = this.resolverDireccionEntrega(metodoEntrega, dto);

    // 5. Facturación — whether/which factura* fields are required depends on
    // Tenant.facturacionModo, resolved independently of pricing. Shared with
    // PublicPedidosB2bService.createPedido — see common/facturacion.ts.
    const factura = resolverFacturacion(tenant.facturacionModo, dto);

    // Defensive: dedupe repeated productId entries instead of trusting the
    // client sent each product at most once.
    const cantidadPorProducto = new Map<string, number>();
    for (const item of dto.items) {
      cantidadPorProducto.set(item.productId, (cantidadPorProducto.get(item.productId) ?? 0) + item.cantidad);
    }
    const productIds = [...cantidadPorProducto.keys()];

    const products = await this.prisma.product.findMany({
      where: { tenantId: tenant.id, id: { in: productIds } },
      include: { category: { select: { activa: true } } },
    });
    if (products.length !== productIds.length) {
      throw new NotFoundException('Uno o más productos no existen en este negocio');
    }
    const noDisponible = products.find((p) => !p.disponible || !p.category.activa);
    if (noDisponible) {
      throw new ConflictException(`"${noDisponible.nombre}" ya no está disponible`);
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    const activePromotions = await this.prisma.promotion.findMany({
      where: { tenantId: tenant.id, activa: true },
    });

    // remaining[productId] = units still not covered by a combo. Combos are
    // applied first (greedily; overlap between promotions is prevented at
    // the /promotions write endpoints, so no product can be claimed by two
    // promotions at once — order of application can't double-count).
    const remaining = new Map(cantidadPorProducto);
    let descuentoTotal = 0;
    const resumenDescuentos: string[] = [];

    for (const promo of activePromotions.filter((p) => p.tipo === PromotionTipo.COMBO)) {
      const config = promo.config as unknown as ComboConfigDto;
      const vecesAplica = Math.min(...config.productIds.map((id) => remaining.get(id) ?? 0));
      if (vecesAplica <= 0) continue;

      for (const id of config.productIds) {
        remaining.set(id, (remaining.get(id) ?? 0) - vecesAplica);
      }

      const precioLista = config.productIds.reduce((sum, id) => sum + Number(productMap.get(id)!.precio), 0);
      const descuentoPorSet = Math.max(0, precioLista - config.precioCombo);
      descuentoTotal += descuentoPorSet * vecesAplica;

      const nombres = config.productIds.map((id) => productMap.get(id)!.nombre).join(' + ');
      resumenDescuentos.push(`Combo ${nombres} x${vecesAplica}`);
    }

    for (const promo of activePromotions.filter((p) => p.tipo === PromotionTipo.DESCUENTO_PRODUCTO)) {
      const config = promo.config as unknown as DescuentoProductoConfigDto;
      const cantidad = remaining.get(config.productId) ?? 0;
      if (cantidad <= 0) continue;

      const product = productMap.get(config.productId)!;
      const precioUnitario = Number(product.precio);
      const descuentoUnitario =
        config.tipoDescuento === 'porcentaje' ? precioUnitario * (config.valor / 100) : Math.min(precioUnitario, config.valor);
      descuentoTotal += descuentoUnitario * cantidad;

      const etiquetaDescuento = config.tipoDescuento === 'porcentaje' ? `${config.valor}%` : `$${config.valor}`;
      resumenDescuentos.push(`${product.nombre} x${cantidad} (-${etiquetaDescuento})`);
    }

    descuentoTotal = round2(descuentoTotal);

    const subtotal = round2(
      [...cantidadPorProducto.entries()].reduce((sum, [id, cantidad]) => sum + cantidad * Number(productMap.get(id)!.precio), 0),
    );

    // Modifiers are resolved per raw cart line (dto.items, not the deduped
    // cantidadPorProducto used above) because two lines for the same product
    // can carry different modifier selections — they can't be merged into a
    // single quantity the way plain product counts can. Deliberately kept
    // out of the combo/descuento math above: modifiers are never discounted,
    // they're added in full on top of the already-discounted subtotal.
    const { modificadoresPorItem, modifiersExtraTotal } = await this.resolverModificadores(tenant.id, productIds, dto.items);

    const total = Math.max(0, round2(subtotal + modifiersExtraTotal - descuentoTotal));

    // 6. pedidoMinimo — needs the calculated total (with discounts, no
    // taxes — there are none), so it can only be checked here.
    if (puntoEnvio?.pedidoMinimo != null) {
      const minimo = Number(puntoEnvio.pedidoMinimo);
      if (total < minimo) {
        const faltante = round2(minimo - total);
        throw new ConflictException(
          `El pedido mínimo para "${puntoEnvio.nombre}" es $${minimo.toFixed(2)} — te faltan $${faltante.toFixed(2)}`,
        );
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const folio = await this.nextFolio(tx, tenant.id);

      // Se resuelve antes de crear el Order — clienteId es una FK requerida
      // desde Módulo 2, así que el Cliente tiene que existir primero (a
      // diferencia de Módulo 1 Etapa 1, donde esto corría después solo para
      // mantener Cliente al día, sin nada que enlazar de vuelta).
      const cliente = await this.clientesService.sincronizarDesdePedido(tx, {
        tenantId: tenant.id,
        canal: ClienteCanal.B2C,
        telefono: dto.clienteTelefono,
        nombre: dto.clienteNombre,
        correo: dto.clienteCorreo,
        fechaPedido: new Date(),
      });

      const nuevoOrder = await tx.order.create({
        data: {
          tenantId: tenant.id,
          clienteId: cliente.id,
          folio,
          clienteNombre: dto.clienteNombre,
          clienteTelefono: dto.clienteTelefono,
          clienteCorreo: dto.clienteCorreo,
          notas: dto.notas,
          horaRecogidaTipo,
          horaRecogida,
          metodoPago: dto.metodoPago,
          // EFECTIVO/TRANSFERENCIA are settled in person — nothing for this
          // system to track, so they're born PAGADO. TARJETA starts
          // PENDIENTE and is flipped by the Stripe webhook once the
          // PaymentIntent created just below actually resolves.
          estadoPago: dto.metodoPago === MetodoPago.TARJETA ? EstadoPago.PENDIENTE : EstadoPago.PAGADO,
          metodoEntrega,
          puntoEnvioId: puntoEnvio?.id,
          ...direccionEntrega,
          ...factura,
          estadoPedido: EstadoPedido.PENDIENTE_CONFIRMACION,
          canalOrigen: CanalOrigen.WEB,
          descuentoTotal,
          notasDescuento: resumenDescuentos.length > 0 ? resumenDescuentos.join('; ') : undefined,
          total,
          items: {
            // One OrderItem per raw cart line (not per distinct product) —
            // see the comment above modifiersExtraTotal for why lines can't
            // be merged once modifiers are involved.
            create: dto.items.map((item, index) => {
              const product = productMap.get(item.productId)!;
              const modificadores = modificadoresPorItem[index];
              return {
                tenantId: tenant.id,
                productId: item.productId,
                nombreProducto: product.nombre,
                precioUnitario: product.precio,
                cantidad: item.cantidad,
                modificadores:
                  modificadores.length > 0
                    ? {
                        create: modificadores.map((m) => ({
                          tenantId: tenant.id,
                          modifierOptionId: m.modifierOptionId,
                          nombreGrupo: m.nombreGrupo,
                          nombre: m.nombre,
                          precioAdicional: m.precioAdicional,
                        })),
                      }
                    : undefined,
              };
            }),
          },
        },
        include: {
          items: {
            include: {
              modificadores: { select: { nombreGrupo: true, nombre: true, precioAdicional: true } },
            },
          },
        },
      });

      return nuevoOrder;
    });

    // TARJETA: the order already exists (folio assigned, PENDIENTE) — now
    // create the PaymentIntent and attach its id/clientSecret. Deliberately
    // outside the transaction above: a network call to Stripe has no
    // business holding the advisory lock/row locks that folio assignment
    // needs. A destination charge (transfer_data.destination = the tenant's
    // connected account, no application_fee_amount) — Aelika takes 0% per
    // order (subscription-only), and already pays Stripe's own fees/losses
    // per the account's `defaults.responsibilities` (see
    // TenantService.createOrContinueStripeAccount), so nothing is deducted here.
    //
    // "Pedido recibido" (audiencia NEGOCIO) ya NO se encola aquí para
    // TARJETA — se pospone hasta que el webhook de Stripe confirme el pago
    // (`payment_intent.succeeded`, ver StripeWebhookController), sin
    // importar cuánto tarde en resolverse. Antes se encolaba en este punto
    // con el PENDIENTE optimista con el que nace el pedido, lo que dejaba el
    // mensaje de Telegram congelado en "en proceso" si el pago se resolvía
    // mal (o tarde) después. Si el intento de cobro falla de entrada (catch
    // abajo) tampoco se notifica nada — de cara al negocio, ese pedido nunca
    // existió.
    if (dto.metodoPago === MetodoPago.TARJETA) {
      try {
        const paymentIntent = await this.stripeService.client.paymentIntents.create({
          amount: Math.round(Number(order.total) * 100),
          currency: 'mxn',
          transfer_data: { destination: tenant.stripeAccountId! },
          automatic_payment_methods: { enabled: true },
          metadata: { orderId: order.id, tenantId: tenant.id, slug, folio: order.folio },
        });

        const orderConPago = await this.prisma.order.update({
          where: { id: order.id },
          data: { stripePaymentIntentId: paymentIntent.id },
          include: {
            items: {
              include: { modificadores: { select: { nombreGrupo: true, nombre: true, precioAdicional: true } } },
            },
          },
        });

        return { ...orderConPago, clientSecret: paymentIntent.client_secret };
      } catch (err) {
        // The order stays on record as FALLIDO rather than silently
        // disappearing — same "never lose a real customer action" principle
        // as everywhere else in this service.
        await this.prisma.order.update({ where: { id: order.id }, data: { estadoPago: EstadoPago.FALLIDO } });
        throw err;
      }
    }

    // EFECTIVO/TRANSFERENCIA: estadoPago ya nació PAGADO/lo que corresponda
    // en la transacción de arriba y no cambia después — encolar aquí mismo.
    void this.encolarPedidoRecibido(tenant.id, tenant.nombre, order);

    return order;
  }

  /**
   * "Pedido recibido" (audiencia NEGOCIO). Best-effort a propósito (ver
   * NotificacionesQueueService.encolarSeguro): jamás debe bloquear ni tumbar
   * la creación del pedido si Redis está caído — por eso el caller nunca le
   * hace `await`, solo la dispara (con `void`). Es async solo para poder
   * resolver la categoría de cada línea antes de armar el texto (ver
   * resolverCategoriasPorProducto) — esa resolución también está protegida
   * con su propio try/catch, así que un fallo ahí tampoco puede propagarse
   * como una promesa rechazada sin manejar.
   *
   * Para EFECTIVO/TRANSFERENCIA se llama al crear el pedido (línea de arriba
   * en createOrder). Para TARJETA se llama desde
   * `notificarPedidoRecibidoTrasPago`, disparado por
   * StripeWebhookController solo cuando el pago ya se confirmó — nunca al
   * crear el pedido.
   */
  private async encolarPedidoRecibido(
    tenantId: string,
    tenantNombre: string,
    order: Prisma.OrderGetPayload<{ include: { items: { include: { modificadores: true } } } }>,
  ): Promise<void> {
    const productIds = order.items.map((item) => item.productId).filter((id): id is string => id !== null);
    const categoriaPorProducto = await this.resolverCategoriasPorProducto(productIds);

    void this.notificacionesQueueService.encolarSeguro({
      tenantId,
      evento: NotificacionEvento.PEDIDO_RECIBIDO,
      mensaje: {
        asunto: `Nuevo pedido #${order.folio}`,
        texto: this.construirReciboPedidoRecibido(tenantNombre, order, categoriaPorProducto),
      },
    });
  }

  /**
   * Categoría de cada producto, resuelta EN VIVO desde el catálogo actual al
   * momento de notificar — a propósito, no un snapshot en OrderItem (ver
   * CLAUDE.md/auditoría: la categoría de un producto puede cambiar, y un
   * pedido no necesita fijar ese dato histórico). Si un producto de la
   * línea fue borrado después de crear el pedido, simplemente no aparece en
   * el mapa devuelto — construirReciboPedidoRecibido omite la categoría en
   * ese caso en vez de fallar. Envuelto en try/catch para preservar el
   * principio "una notificación nunca debe fallar" (ver encolarSeguro): si
   * la consulta a la base de datos falla por algún motivo, el pedido se
   * sigue notificando, solo que sin categorías.
   */
  private async resolverCategoriasPorProducto(productIds: string[]): Promise<Map<string, string>> {
    const idsUnicos = [...new Set(productIds)];
    if (idsUnicos.length === 0) {
      return new Map();
    }

    try {
      const productos = await this.prisma.product.findMany({
        where: { id: { in: idsUnicos } },
        select: { id: true, category: { select: { nombre: true } } },
      });
      return new Map(productos.map((producto) => [producto.id, producto.category.nombre]));
    } catch (error: any) {
      this.logger.error(
        `No se pudieron resolver categorías para la notificación de pedido recibido: ${error?.message ?? error}`,
      );
      return new Map();
    }
  }

  /**
   * Dispara "Pedido recibido" para un pedido TARJETA cuyo pago el webhook de
   * Stripe acaba de confirmar como exitoso — ver
   * StripeWebhookController.handleClassicEvent, el único caller. La
   * idempotencia (no duplicar si Stripe reenvía el mismo evento) es
   * responsabilidad del caller: solo debe invocar este método cuando su
   * propio `updateMany` de estadoPago realmente transicionó a PAGADO, nunca
   * en una entrega duplicada del webhook.
   */
  async notificarPedidoRecibidoTrasPago(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        tenant: { select: { nombre: true } },
        items: { include: { modificadores: { select: { nombreGrupo: true, nombre: true, precioAdicional: true } } } },
      },
    });
    if (!order) {
      return;
    }
    await this.encolarPedidoRecibido(order.tenantId, order.tenant.nombre, order);
  }

  /**
   * Indicador de cobro para "Pedido recibido" — combina metodoPago +
   * estadoPago a propósito, nunca estadoPago solo: un EFECTIVO nace
   * `estadoPago = PAGADO` por diseño del sistema (nada que rastrear), pero
   * eso NO significa que el dinero ya se cobró — el cobro real ocurre al
   * entregar/recoger. Mostrar "PAGADO" ahí sería engañoso para quien lee la
   * notificación y decide si puede surtir el pedido con confianza.
   *
   * Un ícono distinto por caso (✅/⏳/❌/↩️/🕓) para que el estado se lea de
   * un vistazo sin depender del texto. TRANSFERENCIA no tiene flujo real
   * implementado (deshabilitado en el checkout) — se trata igual que
   * EFECTIVO por seguridad si llegara a aparecer, no debería ocurrir hoy.
   */
  private construirIndicadorPago(order: { metodoPago: MetodoPago; estadoPago: EstadoPago }): string {
    if (order.metodoPago === MetodoPago.TARJETA) {
      switch (order.estadoPago) {
        case EstadoPago.PAGADO:
          return '✅ PAGADO CON TARJETA';
        case EstadoPago.FALLIDO:
          return '❌ PAGO CON TARJETA FALLÓ — no se cobró';
        case EstadoPago.REEMBOLSADO:
          return '↩️ REEMBOLSADO';
        case EstadoPago.PENDIENTE:
        default:
          return '⏳ PAGO CON TARJETA EN PROCESO — aún sin confirmar';
      }
    }

    return '🕓 PENDIENTE DE COBRO — se cobra al entregar/recoger';
  }

  /**
   * Texto del mensaje de Telegram para "Pedido recibido" — recibo detallado:
   * folio + indicador de cobro (lo primero, antes que cualquier otro dato —
   * es la señal operativa más urgente para quien recibe la notificación),
   * cliente/teléfono, hora de recogida (solo si HORA_ESPECIFICA — omitida
   * por completo si LO_ANTES_POSIBLE, no se inventa un estimado), cada línea
   * con sus modificadores como "Grupo: Opción", y el total real del pedido.
   *
   * El subtotal de cada línea es (precioUnitario + suma de precioAdicional
   * de sus modificadores) × cantidad — mismo criterio que usa el cálculo real
   * de Order.total para el subtotal + modifiersExtraTotal (ver createOrder).
   * Si el pedido tiene descuentoTotal > 0 (combo o descuento por producto),
   * se agrega una línea "Descuento: -$X" entre las líneas de producto y el
   * TOTAL — el descuento se aplica de forma global (combos no corresponden
   * 1:1 a una línea), así que no se reparte por línea, solo se muestra el
   * monto total descontado. Con esa línea, suma de subtotales de línea menos
   * el descuento sí cuadra con el TOTAL.
   *
   * `categoriaPorProducto` (ver resolverCategoriasPorProducto) trae, cuando
   * está disponible, la categoría actual del producto de cada línea — se
   * muestra entre paréntesis junto al nombre para distinguir productos con
   * el mismo nombre en categorías distintas (ej. "Latte" de Fríos vs. de
   * Calientes). Si la línea no tiene productId (nunca lo tuvo o se puso en
   * null por el borrado del producto, ver OrderItem.productId) o el
   * producto ya no está en el mapa, la línea simplemente no muestra
   * categoría — nunca se trata como error.
   */
  private construirReciboPedidoRecibido(
    tenantNombre: string,
    order: Prisma.OrderGetPayload<{ include: { items: { include: { modificadores: true } } } }>,
    categoriaPorProducto: Map<string, string>,
  ): string {
    const lineas: string[] = [
      `NUEVO PEDIDO #${order.folio} - ${tenantNombre}`,
      this.construirIndicadorPago({ metodoPago: order.metodoPago, estadoPago: order.estadoPago }),
      '------------------------------',
      `Cliente: ${order.clienteNombre}`,
      `Telefono: ${order.clienteTelefono}`,
    ];

    if (order.horaRecogidaTipo === HoraRecogidaTipo.HORA_ESPECIFICA && order.horaRecogida) {
      lineas.push(`Llega en: ${order.horaRecogida}`);
    }

    lineas.push('');

    order.items.forEach((item, index) => {
      const extraPorUnidad = item.modificadores.reduce((sum, m) => sum + Number(m.precioAdicional), 0);
      const subtotalLinea = round2((Number(item.precioUnitario) + extraPorUnidad) * item.cantidad);

      const categoria = item.productId ? categoriaPorProducto.get(item.productId) : undefined;
      const nombreConCategoria = categoria ? `${item.nombreProducto} (${categoria})` : item.nombreProducto;

      lineas.push(
        `${item.cantidad}x ${nombreConCategoria} - $${Number(item.precioUnitario).toFixed(2)} c/u = $${subtotalLinea.toFixed(2)}`,
      );
      for (const modificador of item.modificadores) {
        lineas.push(`   ${modificador.nombreGrupo}: ${modificador.nombre}`);
      }

      if (index < order.items.length - 1) {
        lineas.push('');
      }
    });

    lineas.push('');
    if (Number(order.descuentoTotal) > 0) {
      lineas.push(`Descuento: -$${Number(order.descuentoTotal).toFixed(2)}`);
    }
    lineas.push('------------------------------', `TOTAL: $${Number(order.total).toFixed(2)} MXN`, '', `Recibido: ${this.formatearFechaRecibo(order.createdAt)}`);

    return lineas.join('\n');
  }

  // DD/MM/YYYY HH:mm en la zona horaria de los pilotos (ver TIMEZONE en
  // common/horario.ts) — vía Intl/tzdata, nunca aritmética manual de offset.
  private formatearFechaRecibo(fecha: Date): string {
    const formatter = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const partes = formatter.formatToParts(fecha);
    const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
  }

  /**
   * Returns the "HH:mm" to store, or null. LO_ANTES_POSIBLE always stores
   * null — whatever the client sent in `horaRecogida` is discarded, not
   * validated. HORA_ESPECIFICA requires a value that's both inside today's
   * schedule and at least MARGEN_MINIMO_MINUTOS from now.
   */
  private resolverHoraRecogida(dto: CreatePublicOrderDto, horario: HorarioSemana | null): string | null {
    if (dto.horaRecogidaTipo === HoraRecogidaTipo.LO_ANTES_POSIBLE) {
      return null;
    }

    if (!dto.horaRecogida) {
      throw new BadRequestException('Elige una hora de recogida');
    }

    const horarioHoy = horarioDeHoy(horario);
    if (!horarioHoy?.abierto || !horarioHoy.apertura || !horarioHoy.cierre) {
      throw new ConflictException('El negocio no tiene horario disponible hoy');
    }

    const horaMinima = sumarMinutos(horaActualMexico(), MARGEN_MINIMO_MINUTOS);
    const cotaInferior = horaMinima > horarioHoy.apertura ? horaMinima : horarioHoy.apertura;

    if (dto.horaRecogida < cotaInferior || dto.horaRecogida >= horarioHoy.cierre) {
      throw new BadRequestException(`Elige una hora de recogida entre ${cotaInferior} y ${horarioHoy.cierre}`);
    }

    return dto.horaRecogida;
  }

  /**
   * DOMICILIO requires a puntoEnvioId that belongs to this tenant and is
   * activo — 404 for both "doesn't exist" and "belongs to another tenant"
   * (same convention as everywhere else: never confirm another tenant's
   * resource exists) and also for "inactive" (inactive points are never
   * exposed via the public list either, so from the client's perspective an
   * inactive point isn't observably different from a nonexistent one).
   * RECOGER ignores puntoEnvioId entirely even if the client sent one.
   */
  private async resolverPuntoEnvio(tenantId: string, metodoEntrega: MetodoEntrega, puntoEnvioId: string | undefined) {
    if (metodoEntrega !== MetodoEntrega.DOMICILIO) {
      return null;
    }

    if (!puntoEnvioId) {
      throw new BadRequestException('Elige un punto de envío');
    }

    const puntoEnvio = await this.prisma.puntoEnvio.findUnique({ where: { id: puntoEnvioId } });
    if (!puntoEnvio || puntoEnvio.tenantId !== tenantId || !puntoEnvio.activo) {
      throw new NotFoundException('Punto de envío no encontrado');
    }

    return puntoEnvio;
  }

  /**
   * direccionCalle/Numero/Colonia are required only when metodoEntrega =
   * DOMICILIO — RECOGER forces all four fields to null regardless of what
   * the client sent, same convention as horaRecogida/horaRecogidaTipo above.
   * direccionReferencias is always optional, even for DOMICILIO.
   */
  private resolverDireccionEntrega(metodoEntrega: MetodoEntrega, dto: CreatePublicOrderDto): DireccionFields {
    if (metodoEntrega !== MetodoEntrega.DOMICILIO) {
      return DIRECCION_VACIA;
    }

    const campos = {
      direccionCalle: dto.direccionCalle,
      direccionNumero: dto.direccionNumero,
      direccionColonia: dto.direccionColonia,
    };
    const faltantes = Object.entries(campos)
      .filter(([, valor]) => !valor?.trim())
      .map(([campo]) => campo);
    if (faltantes.length > 0) {
      throw new BadRequestException(`Faltan datos de dirección: ${faltantes.join(', ')}`);
    }

    return {
      direccionCalle: dto.direccionCalle!.trim(),
      direccionNumero: dto.direccionNumero!.trim(),
      direccionColonia: dto.direccionColonia!.trim(),
      direccionReferencias: dto.direccionReferencias?.trim() || null,
    };
  }

  /**
   * Validates each cart line's modifierOptionIds against the ModifierGroups
   * actually assigned to that line's product, and returns the snapshot data
   * (nombre/precioAdicional) needed to create each OrderItem's
   * OrderItemModifier rows, plus the total extra to add to the order.
   *
   * The returned snapshots are ordered by `ProductModifierGroup.orden` (the
   * same field the public catalog already orders by, see
   * `PublicService.getCatalog`) — never by the order `modifierOptionIds`
   * arrived in the request body. That keeps the order the client sends
   * (whatever it happens to be) from leaking into what gets persisted and
   * later shown in the "pedido recibido" notification; it's derived purely
   * from `orden`, never from comparing modifier/group names. Options
   * selected within the same group keep their original relative order
   * (Array.prototype.sort is a stable sort) — only the grouping itself is
   * reordered.
   *
   * No TenantPrismaService here — same reason as the rest of this method:
   * this is a public, unauthenticated endpoint (tenant resolved from the
   * slug, not a JWT), so tenantId is passed explicitly into every where.
   */
  private async resolverModificadores(
    tenantId: string,
    productIds: string[],
    items: CreatePublicOrderDto['items'],
  ): Promise<{
    modificadoresPorItem: { modifierOptionId: string; nombreGrupo: string; nombre: string; precioAdicional: number }[][];
    modifiersExtraTotal: number;
  }> {
    const asignaciones = await this.prisma.productModifierGroup.findMany({
      where: {
        productId: { in: productIds },
        modifierGroup: { tenantId, activo: true },
      },
      include: {
        modifierGroup: {
          include: { opciones: { where: { activo: true } } },
        },
      },
    });

    type GrupoConOpciones = (typeof asignaciones)[number]['modifierGroup'];
    // orden viene de la asignación producto-grupo (ProductModifierGroup),
    // no del ModifierGroup en sí — mismo campo que ya ordena los grupos en
    // PublicService.getCatalog.
    const gruposPorProducto = new Map<string, { orden: number; grupo: GrupoConOpciones }[]>();
    for (const asignacion of asignaciones) {
      const lista = gruposPorProducto.get(asignacion.productId) ?? [];
      lista.push({ orden: asignacion.orden, grupo: asignacion.modifierGroup });
      gruposPorProducto.set(asignacion.productId, lista);
    }

    const modificadoresPorItem: { modifierOptionId: string; nombreGrupo: string; nombre: string; precioAdicional: number }[][] = [];
    let modifiersExtraTotal = 0;

    for (const item of items) {
      const asignacionesProducto = gruposPorProducto.get(item.productId) ?? [];
      const grupos = asignacionesProducto.map((a) => a.grupo);
      const optionIds = item.modifierOptionIds ?? [];

      // a) Every selected option must belong to a group assigned to this
      // product — 404 for anything else, same "never confirm a foreign
      // resource exists" principle as the rest of this service.
      const optionIndex = new Map<
        string,
        { grupo: GrupoConOpciones; ordenGrupo: number; opcion: GrupoConOpciones['opciones'][number] }
      >();
      for (const { orden, grupo } of asignacionesProducto) {
        for (const opcion of grupo.opciones) {
          optionIndex.set(opcion.id, { grupo, ordenGrupo: orden, opcion });
        }
      }

      const seleccionPorGrupo = new Map<string, string[]>();
      for (const optionId of optionIds) {
        const found = optionIndex.get(optionId);
        if (!found) {
          throw new NotFoundException('Una opción seleccionada no está disponible para este producto');
        }
        const seleccionadas = seleccionPorGrupo.get(found.grupo.id) ?? [];
        seleccionadas.push(optionId);
        seleccionPorGrupo.set(found.grupo.id, seleccionadas);
      }

      // b) obligatorio + UNICA needs exactly 1; obligatorio + MULTIPLE needs
      // at least 1; !obligatorio allows 0.
      // c) UNICA never allows more than 1, even when the group is optional.
      for (const grupo of grupos) {
        const seleccionadas = seleccionPorGrupo.get(grupo.id) ?? [];
        if (grupo.tipoSeleccion === TipoSeleccion.UNICA && seleccionadas.length > 1) {
          throw new BadRequestException(`"${grupo.nombre}" solo admite una opción`);
        }
        if (grupo.obligatorio && grupo.tipoSeleccion === TipoSeleccion.UNICA && seleccionadas.length !== 1) {
          throw new BadRequestException(`Elige una opción de "${grupo.nombre}"`);
        }
        if (grupo.obligatorio && grupo.tipoSeleccion === TipoSeleccion.MULTIPLE && seleccionadas.length < 1) {
          throw new BadRequestException(`Elige al menos una opción de "${grupo.nombre}"`);
        }
      }

      const snapshots = optionIds
        .map((optionId) => optionIndex.get(optionId)!)
        .sort((a, b) => a.ordenGrupo - b.ordenGrupo)
        .map(({ grupo, opcion }) => ({
          modifierOptionId: opcion.id,
          nombreGrupo: grupo.nombre,
          nombre: opcion.nombre,
          precioAdicional: Number(opcion.precioAdicional),
        }));
      modificadoresPorItem.push(snapshots);

      const extraPorUnidad = snapshots.reduce((sum, s) => sum + s.precioAdicional, 0);
      modifiersExtraTotal += extraPorUnidad * item.cantidad;
    }

    return { modificadoresPorItem, modifiersExtraTotal: round2(modifiersExtraTotal) };
  }

  /**
   * Per-tenant sequential folio ("#1", "#2", ...), safe under concurrent
   * checkouts: a Postgres advisory lock scoped to the tenant id serializes
   * concurrent transactions racing for the same folio, so a plain
   * MAX(folio)+1 read can't be read twice before either write commits.
   * Must run inside the same transaction as the Order insert.
   */
  private async nextFolio(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(folio AS INTEGER)) AS max FROM orders WHERE "tenantId" = ${tenantId}
    `;
    const next = (rows[0]?.max ?? 0) + 1;
    return String(next);
  }
}
