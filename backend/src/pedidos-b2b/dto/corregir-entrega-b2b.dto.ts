import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { ESTADOS_CIERRE_ENTREGA } from './cerrar-entrega-b2b.dto';

export class CorregirLineaEntregaB2bDto {
  @IsUUID()
  productId: string;

  // Nunca 0: quitar un producto de la entrega es omitirlo de la lista (una línea en 0 no existe).
  @IsInt()
  @Min(1)
  cantidad: number;
}

// Corrección del admin sobre una entrega YA CERRADA: manda el conjunto completo de líneas que debe quedar (nunca precios:
// el servidor toma los del catálogo) y, opcionalmente, el estado (solo Entregada o No recogida; sin él se conserva).
export class CorregirEntregaB2bDto {
  @IsOptional()
  @IsIn(ESTADOS_CIERRE_ENTREGA)
  estado?: (typeof ESTADOS_CIERRE_ENTREGA)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CorregirLineaEntregaB2bDto)
  items: CorregirLineaEntregaB2bDto[];
}
