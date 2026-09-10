import { IsArray, IsBoolean, IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { ReglaCanal, ReglaMensajeCategoria, ReglaTriggerTipo } from '../../../generated/prisma/enums';

/**
 * `triggerConfig`/`filtro`/`plantillaVariables` se aceptan aquí como JSON
 * crudo (shape mínimo: objeto/arreglo) — el shape real depende de `trigger`
 * (para triggerConfig/filtro) y no se puede expresar de forma declarativa
 * con un solo DTO, así que ReglasService.validarPayload los revalida contra
 * el DTO específico que corresponda (mismo patrón que
 * PromotionsService.parseConfig con DescuentoProductoConfigDto/ComboConfigDto)
 * y rechaza con 400 antes de guardar — no en el momento de disparar.
 */
export class CreateReglaDto {
  @IsString()
  @MinLength(1)
  nombre: string;

  @IsEnum(ReglaTriggerTipo)
  trigger: ReglaTriggerTipo;

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  filtro?: unknown[];

  @IsOptional()
  @IsEnum(ReglaCanal)
  canal?: ReglaCanal;

  @IsString()
  @MinLength(1)
  plantillaNombre: string;

  @IsString()
  @MinLength(1)
  plantillaIdioma: string;

  @IsEnum(ReglaMensajeCategoria)
  plantillaCategoria: ReglaMensajeCategoria;

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
