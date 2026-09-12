import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, ValidateIf } from 'class-validator';
import { FiltroImporteOperador } from '../filtro-importe';

// Base compartida por los 3 query DTOs que filtran un campo Decimal(10,2)
// (ListOrdersHistoricoQueryDto, ListPedidosB2bQueryDto, ListPaymentsQueryDto)
// — mismos 3 campos y misma validación en los tres, así que se heredan en
// vez de repetir los decoradores 3 veces. Sin precedente de DTO por
// herencia en el proyecto (los sub-DTOs existentes en common/dto/ se
// componen con @ValidateNested, no se extienden) — se eligió extends aquí
// porque, a diferencia de esos casos, esto no es un objeto anidado: son
// query params HTTP planos (operador/valor/valorHasta en la URL, no
// filtroImporte[operador]=...), y extends es lo único que comparte
// decoradores de propiedad sin anidar el shape.
export class FiltroImporteQueryDto {
  @IsOptional()
  @IsEnum(FiltroImporteOperador)
  operador?: FiltroImporteOperador;

  // Requerido si `operador` viene presente, sin importar cuál — un
  // operador sin valor no filtra nada. Decimal(10,2): máximo 2 decimales.
  @ValidateIf((o) => o.operador !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  valor?: number;

  // Solo tiene sentido (y se exige) cuando operador = ENTRE — el resto de
  // operadores lo ignoran aunque venga en la query.
  @ValidateIf((o) => o.operador === FiltroImporteOperador.ENTRE)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  valorHasta?: number;
}
