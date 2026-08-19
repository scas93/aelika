import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nombre: string;

  @IsOptional()
  @IsInt()
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
