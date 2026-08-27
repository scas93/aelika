import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, DiaSemana } from '../../generated/prisma/client';
import { round2 } from '../common/money';
import { PedidoB2bItemInputDto } from './dto/pedido-b2b-item-input.dto';

// Misma timezone que common/horario.ts (TIMEZONE) — "hoy" para efectos de
// calcularSemanaDestino se resuelve en la zona horaria del negocio, no en la
// del servidor.
const TIMEZONE = 'America/Mexico_City';

/** Cualquier instante, como "YYYY-MM-DD" en la timezone del negocio — nunca la del servidor. */
export function fechaMexicoYMD(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Suma (o resta, con `dias` negativo) días calendario a una fecha "YYYY-MM-DD". */
export function sumarDiasISO(fechaStr: string, dias: number): string {
  const fecha = new Date(`${fechaStr}T00:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Días calendario completos entre dos fechas "YYYY-MM-DD" (hasta - desde). */
export function diasEntreFechasISO(desdeStr: string, hastaStr: string): number {
  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T00:00:00.000Z`);
  return Math.round((hasta.getTime() - desde.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Lógica de negocio del módulo de pedidos B2B, compartida entre el servicio
 * autenticado (PedidosB2bService, vía TenantPrismaService) y el público
 * (PublicPedidosB2bService, vía PrismaService crudo + slug) — para que las
 * reglas (mínimo de piezas, snapshot, cálculo de descuento) no puedan
 * divergir entre ambos flujos. Funciones puras: reciben el cliente Prisma y
 * el tenantId explícitos, nunca asumen sesión. TenantPrismaService.client y
 * PrismaService directo están tipados igual (ambos como PrismaService), así
 * que aceptan el mismo parámetro sin importar quién invoque.
 */

export function assertLunes(semanaInicioStr: string): Date {
  const date = new Date(`${semanaInicioStr}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('"semanaInicio" no es una fecha válida');
  }
  if (date.getUTCDay() !== 1) {
    throw new BadRequestException(
      '"semanaInicio" debe ser un lunes — inicio de la semana del pedido',
    );
  }
  return date;
}

// Orden fijo lunes-domingo — índice = offset en días desde el lunes de la
// semana (PedidoB2b.semanaInicio).
const DIAS_EN_ORDEN: DiaSemana[] = [
  DiaSemana.LUNES,
  DiaSemana.MARTES,
  DiaSemana.MIERCOLES,
  DiaSemana.JUEVES,
  DiaSemana.VIERNES,
  DiaSemana.SABADO,
  DiaSemana.DOMINGO,
];

/**
 * Dada una fecha calendario cualquiera, resuelve a qué `PedidoB2b.semanaInicio`
 * (el lunes de esa semana) pertenece y qué `DiaSemana` le corresponde —
 * PedidoB2bItemDia.dia es un enum de día de semana, no una fecha real; la
 * fecha calendario siempre se deriva así (semanaInicio + offset), nunca se
 * guarda directo. Usado por "Pedidos del día" para resolver qué pedidos
 * tienen algo programado para una fecha específica.
 */
export function resolverSemanaYDia(fechaStr: string): {
  semanaInicio: Date;
  dia: DiaSemana;
} {
  const fecha = new Date(`${fechaStr}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime())) {
    throw new BadRequestException('"fecha" no es una fecha válida');
  }

  const diaSemanaJs = fecha.getUTCDay(); // 0=domingo..6=sábado
  const offsetDesdeLunes = (diaSemanaJs + 6) % 7; // lunes=0 ... domingo=6

  const semanaInicio = new Date(fecha);
  semanaInicio.setUTCDate(fecha.getUTCDate() - offsetDesdeLunes);

  return { semanaInicio, dia: DIAS_EN_ORDEN[offsetDesdeLunes] };
}

/**
 * Resuelve/valida los items de un carrito B2B contra el catálogo del
 * tenant — nunca confía en nombre/precio del cliente (mismo principio que
 * el resto de la app), solo en `productId` + cantidades por día. tenantId
 * siempre se pasa explícito en el `where`, sin importar si `client` es el
 * crudo (público) o el tenant-scoped (autenticado, donde la extensión ya lo
 * inyectaría de todas formas — pasarlo aquí también es redundante pero
 * inofensivo, y necesario para el caller público).
 */
export async function resolverItems(
  client: PrismaService,
  tenantId: string,
  items: PedidoB2bItemInputDto[],
) {
  const productIds = items.map((item) => item.productId);
  const productos = await client.product.findMany({
    where: { id: { in: productIds }, tenantId },
    select: { id: true, nombre: true, precio: true },
  });
  const porId = new Map(productos.map((p) => [p.id, p]));

  let totalPiezas = 0;
  let subtotal = 0;

  const resueltos = items.map((item) => {
    const producto = porId.get(item.productId);
    if (!producto) {
      throw new NotFoundException(
        'Uno o más productos no existen en este negocio',
      );
    }

    const diasVistos = new Set<string>();
    let cantidadTotal = 0;
    for (const dia of item.distribucion) {
      if (diasVistos.has(dia.dia)) {
        throw new BadRequestException(
          `El día "${dia.dia}" está repetido para "${producto.nombre}"`,
        );
      }
      diasVistos.add(dia.dia);
      cantidadTotal += dia.cantidad;
    }

    if (cantidadTotal <= 0) {
      throw new BadRequestException(
        `"${producto.nombre}" no tiene ninguna cantidad asignada en la semana`,
      );
    }

    totalPiezas += cantidadTotal;
    subtotal = round2(subtotal + Number(producto.precio) * cantidadTotal);

    return {
      productId: producto.id,
      nombreProducto: producto.nombre,
      precioUnitario: producto.precio,
      cantidadTotal,
      // Solo se persisten los días con cantidad > 0 — un día ausente es
      // equivalente a 0 unidades ese día.
      distribucion: item.distribucion.filter((dia) => dia.cantidad > 0),
    };
  });

  return { resueltos, totalPiezas, subtotal };
}

export type ItemsResueltos = Awaited<
  ReturnType<typeof resolverItems>
>['resueltos'];

/** Resuelve un código de descuento por texto — case-insensitive (normalizado a mayúsculas). */
export async function resolverCodigoDescuento(
  client: PrismaService,
  tenantId: string,
  codigoInput: string | undefined,
  subtotal: number,
) {
  if (!codigoInput) {
    return {
      codigoDescuentoId: null as string | null,
      codigoDescuentoTexto: null as string | null,
      descuentoPorcentajeAplicado: null as number | null,
      descuentoTotal: 0,
    };
  }

  const codigo = codigoInput.trim().toUpperCase();
  const encontrado = await client.pedidoB2bCodigoDescuento.findFirst({
    where: { tenantId, codigo, activo: true },
  });
  if (!encontrado) {
    throw new NotFoundException(
      'El código de descuento no existe o no está activo',
    );
  }

  const descuentoPorcentajeAplicado = Number(encontrado.descuentoPorcentaje);
  return {
    codigoDescuentoId: encontrado.id as string | null,
    codigoDescuentoTexto: encontrado.codigo as string | null,
    descuentoPorcentajeAplicado: descuentoPorcentajeAplicado as number | null,
    descuentoTotal: round2(subtotal * (descuentoPorcentajeAplicado / 100)),
  };
}

/**
 * No es un solo nested `items: { create: [...] }` — la extensión
 * tenant-scoped de TenantPrismaService solo inyecta tenantId en la
 * operación raíz, no en escrituras anidadas (mismo motivo documentado en
 * ModifierGroupsService.create), y el caller público no tiene esa extensión
 * en absoluto. Cada item se crea como su propia operación raíz con tenantId
 * explícito, y su distribución como un createMany aparte.
 */
export async function crearItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pedidoB2bId: string,
  resueltos: ItemsResueltos,
) {
  for (const item of resueltos) {
    const createdItem = await tx.pedidoB2bItem.create({
      data: {
        tenantId,
        pedidoB2bId,
        productId: item.productId,
        nombreProducto: item.nombreProducto,
        precioUnitario: item.precioUnitario,
        cantidadTotal: item.cantidadTotal,
      } as any,
    });

    if (item.distribucion.length > 0) {
      await tx.pedidoB2bItemDia.createMany({
        data: item.distribucion.map((dia) => ({
          tenantId,
          pedidoB2bItemId: createdItem.id,
          dia: dia.dia,
          cantidad: dia.cantidad,
        })) as any,
      });
    }
  }
}

/**
 * Folio propio por tenant (independiente de Order.folio), mismo patrón de
 * advisory lock que PublicService.nextFolio (Order) pero con una clave de
 * lock distinta (tenantId + namespace) para no compartir/serializar contra
 * el lock de Order. Misma clave sin importar si el caller es el flujo
 * autenticado o el público — ambos escriben a la misma tabla/secuencia de
 * folio por tenant, así que deben serializarse entre sí también. Debe correr
 * dentro de la misma transacción que el insert.
 */
/**
 * Siempre la semana calendario completa (lunes-domingo) inmediatamente
 * siguiente a "hoy" (en la timezone del negocio), sin importar qué día sea
 * hoy — si hoy es lunes, la semana destino es la de la próxima semana, no
 * la actual. Expuesta por GET /public/pedidos-b2b/tenants/:slug para que el
 * frontend deje de recalcular esto por su cuenta (ver proximoLunes() en
 * pedido-flow.tsx) — ese consumo queda para una fase posterior.
 */
export function calcularSemanaDestino(now = new Date()): {
  inicio: string;
  fin: string;
} {
  const hoyStr = fechaMexicoYMD(now);
  const hoy = new Date(`${hoyStr}T00:00:00.000Z`);

  const diaSemanaJs = hoy.getUTCDay(); // 0=domingo..6=sábado
  const diasHastaProximoLunes = diaSemanaJs === 1 ? 7 : ((8 - diaSemanaJs) % 7 || 7);

  const inicio = new Date(hoy);
  inicio.setUTCDate(hoy.getUTCDate() + diasHastaProximoLunes);
  const fin = new Date(inicio);
  fin.setUTCDate(inicio.getUTCDate() + 6);

  return { inicio: inicio.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

export async function nextFolioPedidoB2b(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId} || ':pedidoB2b'))`;
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(folio AS INTEGER)) AS max FROM pedidos_b2b WHERE "tenantId" = ${tenantId}
  `;
  const next = (rows[0]?.max ?? 0) + 1;
  return String(next);
}
