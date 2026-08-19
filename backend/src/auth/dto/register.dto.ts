import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { HorarioSemanaDto } from '../../common/dto/horario-semana.dto';

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
