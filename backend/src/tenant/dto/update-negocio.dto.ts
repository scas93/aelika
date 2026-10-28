import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { HorarioSemanaDto } from '../../common/dto/horario-semana.dto';
import { GiroNegocio } from '../../../generated/prisma/enums';

// Solo lo que edita "Ajustes → Información del negocio". Es una lista cerrada a propósito: cualquier otro campo de Tenant
// (facturación, Stripe, bot, mayoreo…) queda fuera del contrato y el ValidationPipe whitelist lo descarta.
export class UpdateNegocioDto {
  @IsOptional()
  @IsEnum(GiroNegocio)
  giroNegocio?: GiroNegocio;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mensajeBienvenida?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => HorarioSemanaDto)
  horarioAtencion?: HorarioSemanaDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ubicacion?: string;
}
