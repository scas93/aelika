import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  precio?: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  fotoUrl?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;
}
