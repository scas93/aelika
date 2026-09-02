import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { horaActualMexico, horarioDeHoy, isAbiertoAhora, sumarMinutos, HorarioSemana } from '../common/horario';
import { resolverFacturacion } from '../common/facturacion';
import { round2 } from '../common/money';
import {
  CanalOrigen,
  EstadoPago,
  EstadoPedido,
  HoraRecogidaTipo,
  MetodoEntrega,
  MetodoPago,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
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

  async createOrder(slug: string, dto: CreatePublicOrderDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
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

      return tx.order.create({
        data: {
          tenantId: tenant.id,
          folio,
          clienteNombre: dto.clienteNombre,
          clienteTelefono: dto.clienteTelefono,
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
              modificadores: { select: { nombre: true, precioAdicional: true } },
            },
          },
        },
      });
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
            items: { include: { modificadores: { select: { nombre: true, precioAdicional: true } } } },
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

    return order;
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
   * No TenantPrismaService here — same reason as the rest of this method:
   * this is a public, unauthenticated endpoint (tenant resolved from the
   * slug, not a JWT), so tenantId is passed explicitly into every where.
   */
  private async resolverModificadores(
    tenantId: string,
    productIds: string[],
    items: CreatePublicOrderDto['items'],
  ): Promise<{
    modificadoresPorItem: { modifierOptionId: string; nombre: string; precioAdicional: number }[][];
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
    const gruposPorProducto = new Map<string, GrupoConOpciones[]>();
    for (const asignacion of asignaciones) {
      const lista = gruposPorProducto.get(asignacion.productId) ?? [];
      lista.push(asignacion.modifierGroup);
      gruposPorProducto.set(asignacion.productId, lista);
    }

    const modificadoresPorItem: { modifierOptionId: string; nombre: string; precioAdicional: number }[][] = [];
    let modifiersExtraTotal = 0;

    for (const item of items) {
      const grupos = gruposPorProducto.get(item.productId) ?? [];
      const optionIds = item.modifierOptionIds ?? [];

      // a) Every selected option must belong to a group assigned to this
      // product — 404 for anything else, same "never confirm a foreign
      // resource exists" principle as the rest of this service.
      const optionIndex = new Map<string, { grupo: GrupoConOpciones; opcion: GrupoConOpciones['opciones'][number] }>();
      for (const grupo of grupos) {
        for (const opcion of grupo.opciones) {
          optionIndex.set(opcion.id, { grupo, opcion });
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

      const snapshots = optionIds.map((optionId) => {
        const { opcion } = optionIndex.get(optionId)!;
        return {
          modifierOptionId: opcion.id,
          nombre: opcion.nombre,
          precioAdicional: Number(opcion.precioAdicional),
        };
      });
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
