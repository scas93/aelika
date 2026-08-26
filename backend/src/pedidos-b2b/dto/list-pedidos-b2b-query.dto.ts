import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PedidoB2bEstado } from '../../../generated/prisma/enums';

// desde/hasta filtran sobre semanaInicio — la dimensión de negocio natural
// para un pedido semanal, a diferencia de Order que filtra sobre createdAt.
export class ListPedidosB2bQueryDto {
  @IsOptional()
  @IsEnum(PedidoB2bEstado)
  estado?: PedidoB2bEstado;

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
