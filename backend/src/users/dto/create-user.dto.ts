import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../../generated/prisma/enums';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre: string;

  @IsEmail()
  email: string;

  @IsEnum(Role)
  rol: Role;
}
