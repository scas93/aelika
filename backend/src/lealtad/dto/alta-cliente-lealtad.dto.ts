import { IsString, MaxLength, MinLength } from 'class-validator';

export class AltaClienteLealtadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  telefono: string;
}
