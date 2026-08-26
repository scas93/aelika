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
}
