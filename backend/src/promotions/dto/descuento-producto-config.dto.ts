import { IsIn, IsNumber, IsPositive, IsUUID } from 'class-validator';

export class DescuentoProductoConfigDto {
  @IsUUID()
  productId: string;

  @IsIn(['porcentaje', 'monto_fijo'])
  tipoDescuento: 'porcentaje' | 'monto_fijo';

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  valor: number;
}
