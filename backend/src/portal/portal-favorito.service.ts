import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DiaSemana } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { SesionValida } from './portal-acceso.service';

export interface LineaFavorito {
  productId: string;
  nombre: string;
  dias: Partial<Record<DiaSemana, number>>;
}

const DIAS = Object.values(DiaSemana) as DiaSemana[];
const MAX_CANTIDAD = 9999;

/**
 * Pedido favorito del cliente (4d): UNO por cliente (`Cliente.favoritoB2b`), plantilla por día de la semana sin precios.
 * Lo comparten todos los teléfonos autorizados del cliente. Guardar reemplaza el anterior.
 */
@Injectable()
export class PortalFavoritoService {
  constructor(private readonly prisma: PrismaService) {}

  private exigirCliente(sesion: SesionValida) {
    if (!sesion.cliente)
      throw new ConflictException('Elige un cliente para usar tu favorito');
    return sesion.cliente;
  }

  /** Líneas guardadas tal cual (sin filtrar por disponibilidad); null si no hay favorito. Solo del cliente de la sesión. */
  async leerCrudo(sesion: SesionValida): Promise<LineaFavorito[] | null> {
    const c = this.exigirCliente(sesion);
    const fila = await this.prisma.cliente.findFirst({
      where: { id: c.id, tenantId: sesion.tenant.id },
      select: { favoritoB2b: true },
    });
    const crudo = fila?.favoritoB2b as { lineas?: LineaFavorito[] } | null;
    return crudo?.lineas?.length ? crudo.lineas : null;
  }

  /** Favorito vigente: las líneas de productos que ya no están disponibles se quitan y se nombran aparte. */
  async obtener(sesion: SesionValida) {
    const c = this.exigirCliente(sesion);
    const fila = await this.prisma.cliente.findFirstOrThrow({
      where: { id: c.id, tenantId: sesion.tenant.id },
      select: { favoritoB2b: true },
    });
    const crudo = fila.favoritoB2b as {
      guardadoAt?: string;
      lineas?: LineaFavorito[];
    } | null;
    if (!crudo?.lineas?.length)
      return { favorito: null, noDisponibles: [] as string[] };

    const vigentes = await this.prisma.product.findMany({
      where: {
        tenantId: sesion.tenant.id,
        disponible: true,
        id: { in: crudo.lineas.map((l) => l.productId) },
      },
      select: { id: true, nombre: true },
    });
    const porId = new Map(vigentes.map((p) => [p.id, p.nombre]));
    const lineas = crudo.lineas
      .filter((l) => porId.has(l.productId))
      .map((l) => ({
        productId: l.productId,
        nombre: porId.get(l.productId)!,
        dias: l.dias,
      }));
    const noDisponibles = crudo.lineas
      .filter((l) => !porId.has(l.productId))
      .map((l) => l.nombre);
    return {
      favorito: lineas.length
        ? { guardadoAt: crudo.guardadoAt ?? null, lineas }
        : null,
      noDisponibles,
    };
  }

  async guardar(
    sesion: SesionValida,
    lineas: { productId: string; dias: Partial<Record<DiaSemana, number>> }[],
  ) {
    const c = this.exigirCliente(sesion);
    const limpias: {
      productId: string;
      dias: Partial<Record<DiaSemana, number>>;
    }[] = [];
    const vistos = new Set<string>();
    for (const l of lineas) {
      if (vistos.has(l.productId))
        throw new BadRequestException(
          'Un producto está repetido en tu favorito',
        );
      vistos.add(l.productId);
      const dias: Partial<Record<DiaSemana, number>> = {};
      for (const [dia, cant] of Object.entries(l.dias ?? {})) {
        if (!DIAS.includes(dia as DiaSemana))
          throw new BadRequestException(`Día no válido: ${dia}`);
        if (!Number.isInteger(cant) || cant < 0 || cant > MAX_CANTIDAD) {
          throw new BadRequestException(
            'Las cantidades deben ser enteros de 0 a 9999',
          );
        }
        if (cant > 0) dias[dia as DiaSemana] = cant;
      }
      if (Object.keys(dias).length > 0)
        limpias.push({ productId: l.productId, dias });
    }
    if (limpias.length === 0)
      throw new BadRequestException(
        'Agrega al menos un producto con cantidad a tu favorito',
      );

    const productos = await this.prisma.product.findMany({
      where: {
        tenantId: sesion.tenant.id,
        disponible: true,
        id: { in: limpias.map((l) => l.productId) },
      },
      select: { id: true, nombre: true },
    });
    const nombres = new Map(productos.map((p) => [p.id, p.nombre]));
    if (limpias.some((l) => !nombres.has(l.productId))) {
      throw new ConflictException('Uno de los productos ya no está disponible');
    }

    const favorito = {
      guardadoAt: new Date().toISOString(),
      lineas: limpias.map((l) => ({
        productId: l.productId,
        nombre: nombres.get(l.productId)!,
        dias: l.dias,
      })),
    };
    // Un favorito por cliente: se reemplaza el anterior. Solo se toca el cliente de la sesión.
    await this.prisma.cliente.updateMany({
      where: { id: c.id, tenantId: sesion.tenant.id },
      data: { favoritoB2b: favorito },
    });
    return { favorito, noDisponibles: [] as string[] };
  }

  /**
   * Guarda el favorito de UN día de la semana («tu lunes favorito»): reemplaza solo las cantidades de ese día dentro del
   * favorito del cliente y no toca los demás. Si no había favorito, lo crea con solo ese día. La lectura-modificación-escritura
   * se hace con el cliente bloqueado (FOR UPDATE), así que dos guardados simultáneos de días distintos conservan ambos días.
   * Responde lo mismo que `obtener` (favorito vigente completo y productos no disponibles).
   */
  async guardarDia(
    sesion: SesionValida,
    dia: DiaSemana,
    lineas: { productId: string; cantidad: number }[],
  ) {
    const c = this.exigirCliente(sesion);
    if (!DIAS.includes(dia))
      throw new BadRequestException(`Día no válido: ${dia}`);
    const nuevas = new Map<string, number>();
    for (const l of lineas) {
      if (nuevas.has(l.productId))
        throw new BadRequestException(
          'Un producto está repetido en tu favorito',
        );
      if (
        !Number.isInteger(l.cantidad) ||
        l.cantidad < 0 ||
        l.cantidad > MAX_CANTIDAD
      ) {
        throw new BadRequestException(
          'Las cantidades deben ser enteros de 0 a 9999',
        );
      }
      nuevas.set(l.productId, l.cantidad);
    }
    for (const [id, cant] of [...nuevas]) if (cant === 0) nuevas.delete(id);
    if (nuevas.size === 0)
      throw new BadRequestException(
        'Agrega al menos un producto con cantidad a tu favorito',
      );

    // Nombre del catálogo vivo; productos del negocio y disponibles.
    const productos = await this.prisma.product.findMany({
      where: {
        tenantId: sesion.tenant.id,
        disponible: true,
        id: { in: [...nuevas.keys()] },
      },
      select: { id: true, nombre: true },
    });
    const nombres = new Map(productos.map((p) => [p.id, p.nombre]));
    if ([...nuevas.keys()].some((id) => !nombres.has(id))) {
      throw new ConflictException('Uno de los productos ya no está disponible');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${c.id} AND "tenantId" = ${sesion.tenant.id} FOR UPDATE`;
      const fila = await tx.cliente.findFirstOrThrow({
        where: { id: c.id, tenantId: sesion.tenant.id },
        select: { favoritoB2b: true },
      });
      const previo = (
        (fila.favoritoB2b as { lineas?: LineaFavorito[] } | null)?.lineas ?? []
      ).map((l) => ({ ...l, dias: { ...l.dias } }));
      // Se quita el día de todas las líneas (conservando su orden) y se pone el nuevo; al final desaparecen las líneas
      // que se quedaron sin ningún día.
      const resto = previo.map((l) => {
        const { [dia]: _quitado, ...dias } = l.dias;
        return { ...l, dias };
      });
      for (const [productId, cantidad] of nuevas) {
        const l = resto.find((x) => x.productId === productId);
        if (l) {
          l.dias[dia] = cantidad;
          l.nombre = nombres.get(productId)!;
        } else {
          resto.push({
            productId,
            nombre: nombres.get(productId)!,
            dias: { [dia]: cantidad },
          });
        }
      }
      const lineasFinal = resto.filter((l) => Object.keys(l.dias).length > 0);
      await tx.cliente.update({
        where: { id: c.id },
        data: {
          favoritoB2b: {
            guardadoAt: new Date().toISOString(),
            lineas: lineasFinal,
          },
        },
      });
    });
    return this.obtener(sesion);
  }
}
