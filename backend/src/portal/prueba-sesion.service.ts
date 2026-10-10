import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export const COOKIE_PRUEBA = '__Host-portal_prueba';
const DURACION_DIAS = 90;
export const DURACION_MS = DURACION_DIAS * 24 * 60 * 60 * 1000;

export interface EstadoPrueba {
  activa: boolean;
  creadaAt?: Date;
  /** Valor de `renovadaAt` ANTES de esta lectura (la renovación anterior). */
  renovacionAnteriorAt?: Date;
  /** Esta lectura renueva: es la hora en que se renovó ahora. */
  renovadaAt?: Date;
  venceAt?: Date;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Entrega 4a (prueba de sesión, solo staging). La sesión de prueba va en una tabla propia y temporal (`SesionPrueba`,
 * no es tabla de tenant): la tabla definitiva de sesiones del portal se crea en la 4b y esta se elimina entonces.
 * Sin ligar a ClienteTelefono, sin WhatsApp, sin Redis.
 */
@Injectable()
export class PruebaSesionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea una sesión nueva. Devuelve el token en claro (solo se guarda su hash). */
  async iniciar(userAgent?: string) {
    const token = randomBytes(32).toString('hex');
    const ahora = new Date();
    const fila = await this.prisma.sesionPrueba.create({
      data: {
        tokenHash: hashToken(token),
        userAgent: userAgent?.slice(0, 300) ?? null,
        creadaAt: ahora,
        renovadaAt: ahora,
        venceAt: new Date(ahora.getTime() + DURACION_MS),
      },
    });
    return { token, creadaAt: fila.creadaAt, venceAt: fila.venceAt };
  }

  /** Lee y renueva (vencimiento = ahora + 90 días). Cookie ausente, inválida o vencida → `activa: false`. */
  async estado(token: string | undefined): Promise<EstadoPrueba> {
    if (!token) return { activa: false };
    const hash = hashToken(token);
    const ahora = new Date();
    const fila = await this.prisma.sesionPrueba.findUnique({
      where: { tokenHash: hash },
    });
    if (!fila || fila.venceAt <= ahora) {
      if (fila)
        await this.prisma.sesionPrueba.delete({ where: { id: fila.id } });
      return { activa: false };
    }
    const venceAt = new Date(ahora.getTime() + DURACION_MS);
    await this.prisma.sesionPrueba.update({
      where: { id: fila.id },
      data: { renovadaAt: ahora, venceAt },
    });
    return {
      activa: true,
      creadaAt: fila.creadaAt,
      renovacionAnteriorAt: fila.renovadaAt,
      renovadaAt: ahora,
      venceAt,
    };
  }

  async cerrar(token: string | undefined) {
    if (!token) return;
    await this.prisma.sesionPrueba.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }
}
