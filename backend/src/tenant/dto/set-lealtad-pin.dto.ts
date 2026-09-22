import { IsString, Matches } from 'class-validator';

export class SetLealtadPinDto {
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'El PIN debe ser numérico, de 4 a 6 dígitos' })
  pin: string;
}
