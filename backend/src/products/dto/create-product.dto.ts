import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  precio: number;

  @IsUUID()
  categoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  fotoUrl?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;
}
