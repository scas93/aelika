import { ArrayMinSize, ArrayUnique, IsArray, IsNumber, IsPositive, IsUUID } from 'class-validator';

export class ComboConfigDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  productIds: string[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  precioCombo: number;
}
