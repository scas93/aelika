import { IsOptional, IsString, IsUUID, Matches, ValidateIf } from 'class-validator';

const LUNES_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Semana a resumir en una prueba: el lunes en YYYY-MM-DD. Ausente = la semana anterior. */
export class PruebaResumenNegocioDto {
  @IsOptional()
  @IsString()
  @Matches(LUNES_ISO, { message: 'La semana debe ser una fecha AAAA-MM-DD (un lunes)' })
  semanaInicio?: string;
}

export class PruebaResumenClienteDto {
  @IsUUID()
  clienteId: string;

  // La validación definitiva es normalizarCorreo (400 con la dirección recortada).
  @IsString()
  correo: string;

  @IsOptional()
  @IsString()
  @Matches(LUNES_ISO, { message: 'La semana debe ser una fecha AAAA-MM-DD (un lunes)' })
  semanaInicio?: string;
}

/** `null` o vacío = sin Reply-To. */
export class ConfigResumenClientesDto {
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  correoRespuestas?: string | null;
}
