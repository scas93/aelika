import { IsArray, IsBoolean, IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { ReglaCanal, ReglaMensajeCategoria, ReglaTriggerTipo } from '../../../generated/prisma/enums';

// Todo opcional — mismo patrón que UpdatePromotionDto: un PATCH puede traer
// solo el campo que cambia (ej. `{ activa: false }` para desactivar).
export class UpdateReglaDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nombre?: string;

  @IsOptional()
  @IsEnum(ReglaTriggerTipo)
  trigger?: ReglaTriggerTipo;

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  filtro?: unknown[];

  @IsOptional()
  @IsEnum(ReglaCanal)
  canal?: ReglaCanal;

  @IsOptional()
  @IsString()
  @MinLength(1)
  plantillaNombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  plantillaIdioma?: string;

  @IsOptional()
  @IsEnum(ReglaMensajeCategoria)
  plantillaCategoria?: ReglaMensajeCategoria;

  @IsOptional()
  @IsString()
  plantillaTexto?: string;

  @IsOptional()
  @IsArray()
  plantillaVariables?: unknown[];

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
