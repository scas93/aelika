import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Teléfono autorizado de un cliente B2B (en el alta y al agregar uno). Se normaliza a 10 dígitos en el servicio. */
export class TelefonoClienteB2bDto {
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  telefono: string;

  @IsOptional()
  @IsBoolean()
  principal?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombreContacto?: string;
}

export class UpdateTelefonoClienteB2bDto {
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  telefono?: string;

  // null borra el nombre de contacto; ausente no lo toca.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombreContacto?: string | null;
}
