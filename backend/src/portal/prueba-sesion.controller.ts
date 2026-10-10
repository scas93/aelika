import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import {
  COOKIE_PRUEBA,
  DURACION_MS,
  PruebaSesionService,
} from './prueba-sesion.service';

/** Nombre del proyecto de Railway de producción: ahí los endpoints de prueba no existen (404). */
const PROYECTO_PRODUCCION = 'aelika-production';

/** Se evalúa en cada request (no al cargar el módulo) para poder probarlo y para que no dependa del orden de arranque. */
export function pruebaSesionHabilitada(): boolean {
  return process.env.RAILWAY_PROJECT_NAME !== PROYECTO_PRODUCCION;
}

// Atributos fijos de la cookie: __Host- exige Secure, Path=/ y sin Domain.
const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

function leerCookie(req: Request, nombre: string): string | undefined {
  const crudo = req.headers.cookie;
  if (!crudo) return undefined;
  for (const par of crudo.split(';')) {
    const i = par.indexOf('=');
    if (i < 0) continue;
    if (par.slice(0, i).trim() === nombre)
      return decodeURIComponent(par.slice(i + 1).trim());
  }
  return undefined;
}

function ponerCookie(res: Response, token: string) {
  res.cookie(COOKIE_PRUEBA, token, { ...OPCIONES_COOKIE, maxAge: DURACION_MS });
}

function borrarCookie(res: Response) {
  res.clearCookie(COOKIE_PRUEBA, OPCIONES_COOKIE);
}

// Entrega 4a: endpoints de prueba de la sesión del portal (se retiran en la 4b junto con SesionPrueba).
// @Public(): sin JWT del panel; la "sesión" aquí es la cookie de prueba.
@Public()
@Controller('portal/prueba-sesion')
export class PruebaSesionController {
  constructor(private readonly sesiones: PruebaSesionService) {}

  private exigirHabilitado() {
    if (!pruebaSesionHabilitada()) throw new NotFoundException();
  }

  @Post('iniciar')
  async iniciar(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.exigirHabilitado();
    // Si ya había una sesión en este navegador, se reemplaza.
    await this.sesiones.cerrar(leerCookie(req, COOKIE_PRUEBA));
    const { token, creadaAt, venceAt } = await this.sesiones.iniciar(
      req.headers['user-agent'],
    );
    ponerCookie(res, token);
    res.setHeader('Cache-Control', 'no-store');
    return { activa: true, creadaAt, venceAt };
  }

  @Get('estado')
  async estado(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.exigirHabilitado();
    const token = leerCookie(req, COOKIE_PRUEBA);
    const estado = await this.sesiones.estado(token);
    res.setHeader('Cache-Control', 'no-store');
    if (estado.activa && token) ponerCookie(res, token);
    else if (token) borrarCookie(res);
    return estado;
  }

  @Post('cerrar')
  @HttpCode(200)
  async cerrar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.exigirHabilitado();
    await this.sesiones.cerrar(leerCookie(req, COOKIE_PRUEBA));
    borrarCookie(res);
    res.setHeader('Cache-Control', 'no-store');
    return { activa: false };
  }
}
