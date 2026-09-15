import {
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class EscanearLiteDto {
  @IsString()
  @MinLength(2)
  nombreNegocio: string;

  // Requerida solo si no se manda placeId directo — mismo patrón que
  // FiltroImporteQueryDto (ValidateIf sobre otro campo del mismo DTO).
  @ValidateIf((dto: EscanearLiteDto) => !dto.placeId)
  @IsString()
  @MinLength(2)
  ciudad?: string;

  @IsOptional()
  @IsString()
  placeId?: string;

  @IsOptional()
  @IsUrl()
  sitioWebUrl?: string;

  @IsOptional()
  @IsUrl()
  instagramUrl?: string;

  @IsOptional()
  @IsUrl()
  facebookUrl?: string;
}
