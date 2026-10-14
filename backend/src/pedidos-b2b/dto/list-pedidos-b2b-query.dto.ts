import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ESTADOS_B2B_FILTRO, ESTADOS_PAGO_B2B_FILTRO, type EstadoB2bFiltro, type EstadoPagoB2bFiltro } from '../pedidos-b2b-estados';
import { FiltroImporteQueryDto } from '../../common/dto/filtro-importe-query.dto';

// desde/hasta filtran sobre semanaInicio — la dimensión de negocio natural
// para un pedido semanal, a diferencia de Order que filtra sobre createdAt.
// operador/valor/valorHasta (heredados de FiltroImporteQueryDto) filtran
// sobre PedidoB2b.total. Este DTO no es exclusivo de "Históricos" —
// pedidos-b2b/page.tsx ("Pedidos activos") también consume
// GET /pedidos-b2b con el mismo DTO.
export class ListPedidosB2bQueryDto extends FiltroImporteQueryDto {
  @IsOptional()
  @IsIn(ESTADOS_B2B_FILTRO)
  estado?: EstadoB2bFiltro;

  // Coincidencia parcial, case-insensitive — ver
  // PedidosB2bService.buildWhere (Prisma `contains` + `mode: 'insensitive'`).
  // Usado por "Históricos", que a diferencia de "Pedidos activos" pagina de
  // verdad (no trae todo para filtrar en el cliente), así que el filtro de
  // negocio tiene que resolverse en el servidor.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  negocioNombre?: string;

  // `@Type(() => Boolean)` NO sirve aquí — el constructor Boolean() trata
  // cualquier string no vacío como truthy, así que "?cancelado=false" se
  // volvería `true` en vez de `false` (confirmado: Boolean('false') === true
  // en JS). Se compara el string explícitamente en su lugar.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  @IsBoolean()
  cancelado?: boolean;

  // Variante multi-valor de `estado` ("estados=A,B"), como en el export: Pedidos activos pide los 3 estados activos de una vez.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @IsIn(ESTADOS_B2B_FILTRO, { each: true })
  estados?: EstadoB2bFiltro[];

  // Históricos: solo pedidos Completados y Cancelados. Parámetro aparte (en vez de cambiar el listado sin filtros) para no
  // alterar el contrato de los demás consumidores de GET /pedidos-b2b (Pedidos activos pide por semana y por estado).
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  soloHistorico?: boolean;

  // Solo pedidos de semanas ANTERIORES a esta fecha (semanaInicio < semanaAntesDe, "YYYY-MM-DD"): los pedidos activos que
  // quedaron de semanas pasadas. Se combina con el resto de filtros.
  @IsOptional()
  @IsDateString()
  semanaAntesDe?: string;

  // Filtro por estado de pago (Pendiente / Pagado) — Históricos B2B.
  @IsOptional()
  @IsIn(ESTADOS_PAGO_B2B_FILTRO)
  estadoPago?: EstadoPagoB2bFiltro;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}
