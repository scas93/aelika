import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { HorarioSemanaDto } from '../../common/dto/horario-semana.dto';
import { VentanaRecepcionB2bDto } from '../../common/dto/ventana-recepcion-b2b.dto';
import {
  FacturacionModo,
  PedidoB2bModoCobro,
} from '../../../generated/prisma/enums';

// slug/nombre are intentionally absent — out of scope for now (see CLAUDE.md).
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mensajeBienvenida?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  stripeContactEmail?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => HorarioSemanaDto)
  horarioAtencion?: HorarioSemanaDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ubicacion?: string;

  @IsOptional()
  @IsEnum(FacturacionModo)
  facturacionModo?: FacturacionModo;

  @IsOptional()
  @IsEnum(PedidoB2bModoCobro)
  pedidoB2bModoCobro?: PedidoB2bModoCobro;

  @IsOptional()
  @IsInt()
  @IsPositive()
  pedidoB2bMinimoPiezas?: number;

  // Todo-o-nada: si se manda, deben venir los 4 campos (validados dentro de
  // VentanaRecepcionB2bDto). @IsOptional() en class-validator ignora tanto
  // undefined (no tocar) como null (borrar la ventana configurada) — ver
  // normalizarVentanaRecepcion en common/ventana-recepcion-b2b.ts.
  @IsOptional()
  @ValidateNested()
  @Type(() => VentanaRecepcionB2bDto)
  ventanaRecepcionB2b?: VentanaRecepcionB2bDto | null;
}
