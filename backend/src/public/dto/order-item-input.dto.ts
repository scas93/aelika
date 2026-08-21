import { IsArray, IsInt, IsOptional, IsPositive, IsUUID } from 'class-validator';

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
}
