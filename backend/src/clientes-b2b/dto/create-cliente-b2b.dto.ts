import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PedidoB2bModoCobro } from '../../../generated/prisma/enums';
import { TelefonoClienteB2bDto } from './telefono-cliente-b2b.dto';

export class CreateClienteB2bDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre: string;

  // Solo el sufijo: el backend arma `{slug del negocio}-{sufijo}`. Minúsculas, letras, números y guiones.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'El código solo puede tener letras, números y guiones (sin espacios ni acentos)',
  })
  sufijo: string;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  direccion: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  descuentoPorcentaje?: number;

  // Vacía = la modalidad de cobro del negocio.
  @IsOptional()
  @IsEnum(PedidoB2bModoCobro)
  modalidadPago?: PedidoB2bModoCobro;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TelefonoClienteB2bDto)
  telefonos: TelefonoClienteB2bDto[];
}
