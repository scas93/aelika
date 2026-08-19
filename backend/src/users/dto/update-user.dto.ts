import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Role } from '../../../generated/prisma/enums';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  rol?: Role;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
