import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  PortalAccesoService,
  SesionValida,
} from './portal-acceso.service';
import { SESION_MS } from './portal-config';

// __Host-: Secure, Path=/ y sin Domain.
export const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

export const nombreCookieSesion = (slug: string) => `__Host-portal_${slug}`;

export function leerCookie(req: Request, nombre: string): string | undefined {
  const crudo = req.headers.cookie;
  if (!crudo) return undefined;
  for (const par of crudo.split(';')) {
    const i = par.indexOf('=');
    if (i >= 0 && par.slice(0, i).trim() === nombre)
      return decodeURIComponent(par.slice(i + 1).trim());
  }
  return undefined;
}

export function borrarCookieSesion(res: Response, slug: string) {
  res.clearCookie(nombreCookieSesion(slug), OPCIONES_COOKIE);
}

/**
 * Sesión del portal de la petición: revalida contra la base (ver PortalAccesoService.validarSesion) y renueva la cookie.
 * Sin sesión válida → 401 y se borra la cookie.
 */
export async function exigirSesionPortal(
  acceso: PortalAccesoService,
  req: Request,
  res: Response,
  slug: string,
): Promise<SesionValida> {
  const token = leerCookie(req, nombreCookieSesion(slug));
  const sesion = await acceso.validarSesion(slug, token);
  if (!sesion) {
    if (token) borrarCookieSesion(res, slug);
    throw new UnauthorizedException(
      'Tu sesión terminó. Vuelve a entrar con tu teléfono',
    );
  }
  // Renovación: la cookie vuelve a emitirse con 90 días en cada uso.
  res.cookie(nombreCookieSesion(slug), token as string, {
    ...OPCIONES_COOKIE,
    maxAge: SESION_MS,
  });
  return sesion;
}
