import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ESTADOS_B2B_FILTRO, type EstadoB2bFiltro } from '../pedidos-b2b-estados';

// Mismos filtros que ListPedidosB2bQueryDto sin paginación — el export
// devuelve todas las filas que apliquen, como ExportOrdersHistoricoQueryDto.
export class ExportPedidosB2bQueryDto {
  @IsOptional()
  @IsIn(ESTADOS_B2B_FILTRO)
  estado?: EstadoB2bFiltro;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  negocioNombre?: string;

  // Variante multi-valor de `estado` — necesaria porque "Pedidos activos"
  // del dashboard muestra dos estatus a la vez (PENDIENTE_CONFIRMACION +
  // CONFIRMADO_SURTIENDO) sin una sola pestaña por estatus, y `estado` solo
  // acepta uno. Query string como "estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO"
  // — se parte por coma en vez de usar sintaxis de array de query (?estados[]=...)
  // para no introducir un formato nuevo sin precedente en el resto de la app.
  // Si ambos llegan, PedidosB2bService.buildWhere prioriza `estados`.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsIn(ESTADOS_B2B_FILTRO, { each: true })
  estados?: EstadoB2bFiltro[];

  // `@Type(() => Boolean)` NO sirve aquí — Boolean('false') === true en JS
  // (cualquier string no vacío es truthy), así que "?cancelado=false" se
  // volvería `true`. Se compara el string explícitamente en su lugar.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  @IsBoolean()
  cancelado?: boolean;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
