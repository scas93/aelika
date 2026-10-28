import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/enums';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// Dueño y Gerente administran el equipo; lo que el Gerente NO puede hacer (crear/ascender/tocar Dueños) lo aplica UsersService.
@Roles(Role.DUENO, Role.GERENTE)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.rol, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.sub, user.rol, id, dto);
  }
}
