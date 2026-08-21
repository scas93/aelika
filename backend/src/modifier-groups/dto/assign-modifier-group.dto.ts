import { IsInt, IsOptional, Min } from 'class-validator';

export class AssignModifierGroupDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;
}
