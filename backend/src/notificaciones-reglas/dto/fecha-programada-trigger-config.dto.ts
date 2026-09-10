import { IsISO8601 } from 'class-validator';

/**
 * Shape de `Regla.triggerConfig` cuando `trigger = FECHA_PROGRAMADA`. Debe
 * venir con offset/zona explícita (`strict: true` exige el formato completo
 * ISO 8601, ej. con `Z` o `+00:00`) — ver el supuesto declarado en
 * ReglaBarridoService sobre por qué `fechaHora` tiene que ser un instante
 * absoluto, no una hora local ambigua. Que los minutos/segundos sean cero
 * (el job corre cada hora en punto) se valida aparte en
 * ReglasService.validarPayload, no aquí — no es un problema de shape.
 */
export class FechaProgramadaTriggerConfigDto {
  @IsISO8601({ strict: true })
  fechaHora: string;
}
