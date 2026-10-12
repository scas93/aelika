import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  HttpCode,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { DiaSemana } from '../../generated/prisma/enums';
import { PortalAccesoService } from './portal-acceso.service';
import { PortalCatalogoService } from './portal-catalogo.service';
import { PortalFavoritoService } from './portal-favorito.service';
import { PortalMisPedidosService } from './portal-mis-pedidos.service';
import { PortalPedidosService } from './portal-pedidos.service';
import { exigirSesionPortal } from './portal-sesion-http';

const ENCABEZADO_PORTAL = 'x-portal-request';
const SLUG = /^[a-z0-9-]{1,80}$/;

class SlugQuery {
  @IsString() @IsNotEmpty() @Matches(SLUG) slug!: string;
}

class ListaPedidosQuery extends SlugQuery {
  @IsOptional() @IsString() @MaxLength(10) cursor?: string;
}

class ItemEntregaDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(0) @Max(9999) cantidad!: number;
}

class EntregaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe ser YYYY-MM-DD' })
  fecha!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemEntregaDto)
  items!: ItemEntregaDto[];
}

// Nunca trae precios, cliente ni descuento: el servidor los resuelve (cliente = el de la sesión).
class CrearPedidoPortalDto {
  @IsString() @IsNotEmpty() @Matches(SLUG) slug!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => EntregaDto)
  entregas!: EntregaDto[];

  @IsOptional() @IsString() @MaxLength(500) notaCliente?: string;
}

class LineaFavoritoDto {
  @IsUUID() productId!: string;
  @IsObject() dias!: Partial<Record<DiaSemana, number>>;
}

class GuardarFavoritoDto {
  @IsString() @IsNotEmpty() @Matches(SLUG) slug!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineaFavoritoDto)
  lineas!: LineaFavoritoDto[];
}

// Catálogo, favorito y creación de pedidos del portal del cliente B2B (Fase 4, 4d). Públicos (sin JWT del panel): la
// autorización es la sesión del portal y el cliente SIEMPRE es el de la sesión, nunca uno que mande el cliente.
@Public()
@Controller('portal')
export class PortalPedidosController {
  constructor(
    private readonly acceso: PortalAccesoService,
    private readonly catalogo: PortalCatalogoService,
    private readonly favorito: PortalFavoritoService,
    private readonly pedidos: PortalPedidosService,
    private readonly misPedidos: PortalMisPedidosService,
  ) {}

  private exigirEncabezado(req: Request) {
    if (req.headers[ENCABEZADO_PORTAL] !== '1')
      throw new BadRequestException('Solicitud no válida');
  }

  @Get('catalogo')
  async obtenerCatalogo(
    @Query() q: SlugQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.catalogo.catalogo(
      await exigirSesionPortal(this.acceso, req, res, q.slug),
    );
  }

  @Get('favorito')
  async obtenerFavorito(
    @Query() q: SlugQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.favorito.obtener(
      await exigirSesionPortal(this.acceso, req, res, q.slug),
    );
  }

  @Put('favorito')
  @HttpCode(200)
  async guardarFavorito(
    @Body() dto: GuardarFavoritoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.exigirEncabezado(req);
    res.setHeader('Cache-Control', 'no-store');
    const sesion = await exigirSesionPortal(this.acceso, req, res, dto.slug);
    return this.favorito.guardar(sesion, dto.lineas);
  }

  // ---- Ver mis pedidos (4e): solo lectura, siempre del cliente de la sesión ----

  @Get('pedidos')
  async listarPedidos(
    @Query() q: ListaPedidosQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.misPedidos.listar(
      await exigirSesionPortal(this.acceso, req, res, q.slug),
      q.cursor,
    );
  }

  @Get('pedidos/:folio')
  async detallePedido(
    @Param('folio') folio: string,
    @Query() q: SlugQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.misPedidos.detalle(
      await exigirSesionPortal(this.acceso, req, res, q.slug),
      folio,
    );
  }

  @Post('pedidos/:folio/favorito')
  @HttpCode(200)
  async favoritoDesdePedido(
    @Param('folio') folio: string,
    @Body() dto: SlugQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.exigirEncabezado(req);
    res.setHeader('Cache-Control', 'no-store');
    const sesion = await exigirSesionPortal(this.acceso, req, res, dto.slug);
    return this.misPedidos.usarComoFavorito(sesion, folio);
  }

  @Post('pedidos')
  async crearPedido(
    @Body() dto: CrearPedidoPortalDto,
    @Headers('idempotency-key') idemKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.exigirEncabezado(req);
    if (idemKey !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(idemKey)) {
      throw new BadRequestException('Idempotency-Key no válida');
    }
    res.setHeader('Cache-Control', 'no-store');
    const sesion = await exigirSesionPortal(this.acceso, req, res, dto.slug);
    return this.pedidos.crear(sesion, dto.entregas, dto.notaCliente, idemKey);
  }
}
