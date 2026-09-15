import {
  IsBoolean,
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

  // Requerida solo si de verdad se va a intentar un Text Search — mismo
  // patrón que FiltroImporteQueryDto (ValidateIf sobre otros campos del
  // mismo DTO). Con placeId, o con cualquiera de las dos banderas que
  // evitan la búsqueda (mapsConfirmadoAusente, googleMapsSearch:false), no
  // hace falta ciudad — ver reglas de precedencia en el orquestador.
  @ValidateIf(
    (dto: EscanearLiteDto) =>
      !dto.placeId &&
      !dto.mapsConfirmadoAusente &&
      dto.googleMapsSearch !== false,
  )
  @IsString()
  @MinLength(2)
  ciudad?: string;

  @IsOptional()
  @IsString()
  placeId?: string;

  // Default true (implícito: ausencia de la bandera = búsqueda normal). Si
  // false y no hay placeId, omite Maps por completo (regla 4) sin intentar
  // Text Search — para cuando hay riesgo de ambigüedad (sucursales, ciudad
  // incierta) y se prefiere no arriesgar un match incorrecto. Se ignora si
  // viene placeId (un ID directo no tiene ambigüedad que evitar).
  @IsOptional()
  @IsBoolean()
  googleMapsSearch?: boolean;

  // Default false. Si true, Maps entra directo como {tieneCanal: false}
  // (regla 3 — 0/25, SÍ cuenta en el denominador) sin llamar la
  // integración — para cuando se sabe con certeza que el negocio no tiene
  // ficha de Maps (caso real: Aelika). Gana sobre googleMapsSearch; si
  // además viene placeId, se ignora la bandera (contradicción) y se prioriza
  // el placeId.
  @IsOptional()
  @IsBoolean()
  mapsConfirmadoAusente?: boolean;

  @IsOptional()
  @IsUrl()
  sitioWebUrl?: string;

  // Default false. Si true y no hay sitioWebUrl, Sitio web entra como
  // regla 3 (0 pts, cuenta en el denominador) sin intentar fetch. Si además
  // viene sitioWebUrl, se ignora la bandera (contradicción) y se prioriza
  // la URL.
  @IsOptional()
  @IsBoolean()
  sitioWebConfirmadoAusente?: boolean;

  @IsOptional()
  @IsUrl()
  instagramUrl?: string;

  @IsOptional()
  @IsBoolean()
  instagramConfirmadoAusente?: boolean;

  @IsOptional()
  @IsUrl()
  facebookUrl?: string;

  @IsOptional()
  @IsBoolean()
  facebookConfirmadoAusente?: boolean;
}
