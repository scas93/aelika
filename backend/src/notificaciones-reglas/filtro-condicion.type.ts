import { ReglaFiltroCampo, ReglaFiltroOperador } from '../../generated/prisma/enums';

/**
 * Forma de un elemento de `Regla.filtro` (ver comentario del campo en
 * schema.prisma) — no se valida con un DTO/class-validator todavía porque
 * esta etapa no expone ningún endpoint que lo reciba desde afuera; los
 * únicos callers son internos (ReglasFiltroService.evaluar, tests).
 */
export interface FiltroCondicion {
  campo: ReglaFiltroCampo;
  operador: ReglaFiltroOperador;
  valor: number;
}
