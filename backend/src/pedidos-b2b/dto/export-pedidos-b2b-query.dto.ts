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
import { ESTADOS_B2B_FILTRO, ESTADOS_PAGO_B2B_FILTRO, type EstadoB2bFiltro, type EstadoPagoB2bFiltro } from '../pedidos-b2b-estados';

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

  // Históricos: solo pedidos Completados y Cancelados. Parámetro aparte (en vez de cambiar el listado sin filtros) para no
  // alterar el contrato de los demás consumidores de GET /pedidos-b2b (Pedidos activos pide por semana y por estado).
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  soloHistorico?: boolean;

  // Columnas del Excel: HISTORICOS (pantalla de Históricos) o ACTIVOS (Pedidos activos). No filtra nada. Sin ella manda
  // `soloHistorico` (compatibilidad con llamadas anteriores) y, si tampoco viene, las de Pedidos activos.
  @IsOptional()
  @IsIn(['ACTIVOS', 'HISTORICOS'])
  vista?: 'ACTIVOS' | 'HISTORICOS';

  // Solo pedidos de semanas ANTERIORES a esta fecha (semanaInicio < semanaAntesDe, "YYYY-MM-DD"): los pedidos activos que
  // quedaron de semanas pasadas. Se combina con el resto de filtros.
  @IsOptional()
  @IsDateString()
  semanaAntesDe?: string;

  // Filtro por estado de pago (Pendiente / Pagado) — Históricos B2B.
  // Uno o varios valores ("estadoPago=PAGADO" o "estadoPago=PENDIENTE,PAGADO"): dentro del filtro se combinan con O.
  // Un solo valor, en el formato de siempre, funciona igual. Todos los valores = sin filtrar.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @IsIn(ESTADOS_PAGO_B2B_FILTRO, { each: true })
  estadoPago?: EstadoPagoB2bFiltro[];

  // Históricos con selección múltiple de Estado: "Cancelado" no es un estado sino el indicador `cancelado`. Con `conCancelados=true`
  // y `estados`, el resultado es (estadoPedido en `estados` Y no cancelado) O cancelado en cualquier estado; un pedido que cumple
  // por las dos vías sale una sola vez. Sin `estados`, equivale a `cancelado=true`.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  conCancelados?: boolean;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
