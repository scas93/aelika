import { IsBoolean, IsEnum, IsObject, IsOptional } from 'class-validator';
import { PromotionTipo } from '../../../generated/prisma/enums';

export class UpdatePromotionDto {
  @IsOptional()
  @IsEnum(PromotionTipo)
  tipo?: PromotionTipo;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
