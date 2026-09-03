import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrderItemInputDto } from './order-item-input.dto';
import { HoraRecogidaTipo, MetodoEntrega, MetodoPago } from '../../../generated/prisma/enums';

const HORA_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Deliberately has no price/total fields — those are never trusted from the
// client. See PublicService.createOrder for the server-side price/discount
// calculation, which is the only source of truth.
export class CreatePublicOrderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  clienteNombre: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  clienteTelefono: string;

  // Correo general del cliente — opcional, independiente de facturación (ver
  // facturaCorreo más abajo). Destinatario principal de las notificaciones
  // de audiencia Cliente, ver OrdersService.avanzar.
  @IsOptional()
  @IsEmail()
  clienteCorreo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;

  // Required only when metodoEntrega = RECOGER (the default) — enforced in
  // PublicService, since it depends on another field's value. Ignored
  // entirely for DOMICILIO, so it's optional here rather than always required.
  @IsOptional()
  @IsEnum(HoraRecogidaTipo)
  horaRecogidaTipo?: HoraRecogidaTipo;

  // Required only when horaRecogidaTipo = HORA_ESPECIFICA — enforced in
  // PublicService, not here, since it depends on another field's value.
  @IsOptional()
  @Matches(HORA_PATTERN, { message: 'horaRecogida debe tener formato HH:mm' })
  horaRecogida?: string;

  @IsEnum(MetodoPago)
  metodoPago: MetodoPago;

  // Optional, defaults to RECOGER in PublicService — keeps existing pickup-only
  // clients working without sending this field at all.
  @IsOptional()
  @IsEnum(MetodoEntrega)
  metodoEntrega?: MetodoEntrega;

  // Required only when metodoEntrega = DOMICILIO — enforced in PublicService.
  @IsOptional()
  @IsUUID()
  puntoEnvioId?: string;

  // direccionCalle/Numero/Colonia are required only when metodoEntrega =
  // DOMICILIO — enforced in PublicService, not here (same convention as
  // puntoEnvioId above). direccionReferencias is always optional.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  direccionCalle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  direccionNumero?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  direccionColonia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccionReferencias?: string;

  @IsOptional()
  @IsBoolean()
  requiereFactura?: boolean;

  // All factura* fields below are only required together, conditionally, per
  // Tenant.facturacionModo — enforced in PublicService, not here.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  facturaRazonSocial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  facturaRfc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  facturaRegimenFiscal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  facturaUsoCfdi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  facturaCodigoPostal?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  facturaCorreo?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];
}
