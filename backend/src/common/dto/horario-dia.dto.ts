import { IsBoolean, IsOptional, Matches } from 'class-validator';

const HORA_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class HorarioDiaDto {
  @IsBoolean()
  abierto: boolean;

  @IsOptional()
  @Matches(HORA_PATTERN, { message: 'apertura debe tener formato HH:mm' })
  apertura?: string | null;

  @IsOptional()
  @Matches(HORA_PATTERN, { message: 'cierre debe tener formato HH:mm' })
  cierre?: string | null;
}
