import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { HorarioDiaDto } from './horario-dia.dto';

export class HorarioSemanaDto {
  @ValidateNested()
  @Type(() => HorarioDiaDto)
  lunes: HorarioDiaDto;

  @ValidateNested()
  @Type(() => HorarioDiaDto)
  martes: HorarioDiaDto;

  @ValidateNested()
  @Type(() => HorarioDiaDto)
  miercoles: HorarioDiaDto;

  @ValidateNested()
  @Type(() => HorarioDiaDto)
  jueves: HorarioDiaDto;

  @ValidateNested()
  @Type(() => HorarioDiaDto)
  viernes: HorarioDiaDto;

  @ValidateNested()
  @Type(() => HorarioDiaDto)
  sabado: HorarioDiaDto;

  @ValidateNested()
  @Type(() => HorarioDiaDto)
  domingo: HorarioDiaDto;
}
