import { IsEnum, IsInt, IsString, Min, MinLength } from 'class-validator';
import { ReglaPlantillaVariableFuente } from '../../../generated/prisma/enums';

/**
 * Un elemento de `Regla.plantillaVariables` — ver PlantillaVariable (el
 * tipo que ya consume ReglaEnvioService). `valor` se valida a nivel de
 * shape aquí (string no vacío); qué valores concretos son válidos por
 * `fuente` (ej. "nombre"/"folio") se revisa en ReglasService.validarPayload,
 * reusando las mismas constantes que ReglaEnvioService (CAMPO_CLIENTE_SOPORTADO/
 * CAMPO_PEDIDO_SOPORTADO) para no duplicar esa whitelist.
 */
export class PlantillaVariableDto {
  @IsInt()
  @Min(1)
  posicion: number;

  @IsEnum(ReglaPlantillaVariableFuente)
  fuente: ReglaPlantillaVariableFuente;

  @IsString()
  @MinLength(1)
  valor: string;
}
