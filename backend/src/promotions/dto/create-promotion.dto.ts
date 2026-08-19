import { IsBoolean, IsEnum, IsObject, IsOptional } from 'class-validator';
import { PromotionTipo } from '../../../generated/prisma/enums';

export class CreatePromotionDto {
  @IsEnum(PromotionTipo)
  tipo: PromotionTipo;

  // Shape depends on `tipo` — validated in PromotionsService against
  // DescuentoProductoConfigDto or ComboConfigDto, not here.
  @IsObject()
  config: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
