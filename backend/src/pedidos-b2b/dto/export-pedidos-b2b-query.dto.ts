import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PedidoB2bEstado } from '../../../generated/prisma/enums';

// Mismos filtros que ListPedidosB2bQueryDto sin paginación — el export
// devuelve todas las filas que apliquen, como ExportOrdersHistoricoQueryDto.
export class ExportPedidosB2bQueryDto {
  @IsOptional()
  @IsEnum(PedidoB2bEstado)
  estado?: PedidoB2bEstado;

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
  @IsEnum(PedidoB2bEstado, { each: true })
  estados?: PedidoB2bEstado[];

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
