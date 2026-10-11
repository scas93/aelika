import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { IsNotEmpty, IsString, IsUUID, Matches } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import {
  PortalAccesoService,
  type ContextoSolicitud,
  type SesionValida,
} from './portal-acceso.service';
import { DISPOSITIVO_MS, SESION_MS } from './portal-config';

const COOKIE_DISPOSITIVO = '__Host-portal_disp';
const ENCABEZADO_PORTAL = 'x-portal-request';
// __Host-: Secure, Path=/ y sin Domain.
const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

class SlugDto {
  @IsString() @IsNotEmpty() @Matches(/^[a-z0-9-]{1,80}$/) slug!: string;
}
class PedirCodigoDto extends SlugDto {
  @IsString() @IsNotEmpty() telefono!: string;
}
class VerificarDto extends PedirCodigoDto {
  @IsString() @IsNotEmpty() codigo!: string;
}
class ElegirClienteDto extends SlugDto {
  @IsUUID() clienteId!: string;
}

function leerCookie(req: Request, nombre: string): string | undefined {
  const crudo = req.headers.cookie;
  if (!crudo) return undefined;
  for (const par of crudo.split(';')) {
    const i = par.indexOf('=');
    if (i >= 0 && par.slice(0, i).trim() === nombre)
      return decodeURIComponent(par.slice(i + 1).trim());
  }
  return undefined;
}

const nombreCookieSesion = (slug: string) => `__Host-portal_${slug}`;

function ipDe(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const primero = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return primero || req.socket.remoteAddress || 'desconocida';
}

// Acceso al portal del cliente B2B (Fase 4, 4b). Público (sin JWT del panel); la sesión es la cookie por negocio.
@Public()
@Controller('portal/acceso')
export class PortalAccesoController {
  constructor(private readonly acceso: PortalAccesoService) {}

  /** Anti-CSRF: las escrituras exigen un encabezado propio (un sitio ajeno no puede enviarlo sin pasar por CORS). */
  private exigirEncabezado(req: Request) {
    if (req.headers[ENCABEZADO_PORTAL] !== '1')
      throw new BadRequestException('Solicitud no válida');
  }

  /** Dispositivo: UUID emitido por el servidor en cookie; se crea en la primera solicitud. */
  private dispositivo(req: Request, res: Response): string {
    let id = leerCookie(req, COOKIE_DISPOSITIVO);
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      id = randomUUID();
      res.cookie(COOKIE_DISPOSITIVO, id, {
        ...OPCIONES_COOKIE,
        maxAge: DISPOSITIVO_MS,
      });
    }
    return id;
  }

  private contexto(req: Request, res: Response): ContextoSolicitud {
    return {
      dispositivoId: this.dispositivo(req, res),
      ip: ipDe(req),
      userAgent: req.headers['user-agent'],
    };
  }

  private borrarCookieSesion(res: Response, slug: string) {
    res.clearCookie(nombreCookieSesion(slug), OPCIONES_COOKIE);
  }

  private async exigirSesion(
    req: Request,
    res: Response,
    slug: string,
  ): Promise<SesionValida> {
    const token = leerCookie(req, nombreCookieSesion(slug));
    const sesion = await this.acceso.validarSesion(slug, token);
    if (!sesion) {
      if (token) this.borrarCookieSesion(res, slug);
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

  @Post('pedir-codigo')
  @HttpCode(200)
  async pedirCodigo(
    @Body() dto: PedirCodigoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.exigirEncabezado(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.acceso.pedirCodigo(
      dto.slug,
      dto.telefono,
      this.contexto(req, res),
    );
  }

  @Post('verificar')
  @HttpCode(200)
  async verificar(
    @Body() dto: VerificarDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.exigirEncabezado(req);
    res.setHeader('Cache-Control', 'no-store');
    const { token, requiereSeleccion } = await this.acceso.verificar(
      dto.slug,
      dto.telefono,
      dto.codigo,
      this.contexto(req, res),
    );
    res.cookie(nombreCookieSesion(dto.slug), token, {
      ...OPCIONES_COOKIE,
      maxAge: SESION_MS,
    });
    return { ok: true, requiereSeleccion };
  }

  @Get('sesion')
  async sesion(
    @Query() q: SlugDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const s = await this.exigirSesion(req, res, q.slug);
    return {
      negocio: { nombre: s.tenant.nombre },
      telefonoTerminacion: s.telefono.slice(-4),
      cliente: s.cliente,
      clientes: s.clientes,
      requiereSeleccion: s.cliente === null,
    };
  }

  @Post('cliente')
  @HttpCode(200)
  async cliente(
    @Body() dto: ElegirClienteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.exigirEncabezado(req);
    res.setHeader('Cache-Control', 'no-store');
    const s = await this.exigirSesion(req, res, dto.slug);
    const cliente = await this.acceso.elegirCliente(s, dto.clienteId);
    return { ok: true, cliente };
  }

  @Post('cerrar')
  @HttpCode(200)
  async cerrar(
    @Body() dto: SlugDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.exigirEncabezado(req);
    res.setHeader('Cache-Control', 'no-store');
    await this.acceso.cerrar(leerCookie(req, nombreCookieSesion(dto.slug)));
    this.borrarCookieSesion(res, dto.slug);
    return { ok: true };
  }
}
