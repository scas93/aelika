import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class OrderItemInputDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @IsPositive()
  cantidad: number;
}
