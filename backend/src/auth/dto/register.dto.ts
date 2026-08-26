import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HorarioSemanaDto } from '../../common/dto/horario-semana.dto';
import { TipoStorefront } from '../../../generated/prisma/enums';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombreNegocio: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El slug solo puede contener minúsculas, números y guiones',
  })
  @MinLength(3)
  @MaxLength(60)
  slug: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombreDueno: string;

  // Obligatorio y sin default a nivel de API a propósito — quien registra el
  // negocio debe elegirlo explícitamente (ver CLAUDE.md). El @default a
  // nivel de columna en Tenant existe solo para el backfill de tenants
  // creados antes de este campo, no para cubrir este DTO.
  @IsEnum(TipoStorefront)
  tipoStorefront: TipoStorefront;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => HorarioSemanaDto)
  horarioAtencion?: HorarioSemanaDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ubicacion?: string;
}
