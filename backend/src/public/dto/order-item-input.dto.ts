import { Transform } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';
import { NotaLineaMaxima, normalizarNotaLinea } from '../../common/nota-linea';

export class OrderItemInputDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @IsPositive()
  cantidad: number;

  // Validated in PublicService against the ModifierGroups actually assigned
  // to this product — never priced/trusted here, same principle as the rest
  // of this DTO never carrying a price field.
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  modifierOptionIds?: string[];

  // Nota por producto (opcional). Se normaliza aquí mismo (espacios, saltos de línea); vacía tras normalizar = sin nota.
  // Un valor que no es string se deja intacto para que IsString lo rechace.
  @Transform(({ value }) => (typeof value === 'string' ? (normalizarNotaLinea(value) ?? undefined) : value))
  @IsOptional()
  @IsString()
  @NotaLineaMaxima()
  nota?: string;
}
