import { IsEnum, IsNumber } from 'class-validator';
import { ReglaFiltroCampo, ReglaFiltroOperador } from '../../../generated/prisma/enums';

/**
 * Un elemento de `Regla.filtro` — ver FiltroCondicion (el tipo que ya
 * consume ReglasFiltroService). Este DTO es la validación de entrada al
 * guardar una Regla desde el panel (Etapa 3); ReglasFiltroService sigue
 * siendo la única fuente de verdad de qué campo/operador son válidos — este
 * archivo solo importa esos mismos enums, no los redefine.
 */
export class FiltroCondicionDto {
  @IsEnum(ReglaFiltroCampo)
  campo: ReglaFiltroCampo;

  @IsEnum(ReglaFiltroOperador)
  operador: ReglaFiltroOperador;

  @IsNumber()
  valor: number;
}
