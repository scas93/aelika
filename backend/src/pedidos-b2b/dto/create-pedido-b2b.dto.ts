import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PedidoB2bItemInputDto } from './pedido-b2b-item-input.dto';

export class CreatePedidoB2bDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  negocioNombre: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactoNombre: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  contactoTelefono: string;

  @IsEmail()
  @MaxLength(200)
  contactoCorreo: string;

  // "YYYY-MM-DD" — debe ser un lunes real, validado en PedidosB2bService
  // (no a nivel de DTO, para poder dar un mensaje claro en español).
  @IsDateString()
  semanaInicio: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  codigoDescuento?: string;

  // Mismos 6 campos + requiereFactura que CreatePublicOrderDto — solo se
  // requieren juntos, condicionalmente, según Tenant.facturacionModo,
  // enforced en PublicPedidosB2bService (ver common/facturacion.ts), no aquí.
  @IsOptional()
  @IsBoolean()
  requiereFactura?: boolean;

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
  @Type(() => PedidoB2bItemInputDto)
  items: PedidoB2bItemInputDto[];
}
