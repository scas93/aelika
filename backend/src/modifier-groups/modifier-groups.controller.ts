import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ModifierGroupsService } from './modifier-groups.service';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import { CreateModifierOptionDto } from './dto/create-modifier-option.dto';
import { UpdateModifierOptionDto } from './dto/update-modifier-option.dto';
import { AssignModifierGroupDto } from './dto/assign-modifier-group.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

@Controller('modifier-groups')
export class ModifierGroupsController {
  constructor(private readonly modifierGroupsService: ModifierGroupsService) {}

  @Get()
  findAll() {
    return this.modifierGroupsService.findAll();
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Post()
  create(@Body() dto: CreateModifierGroupDto) {
    return this.modifierGroupsService.create(dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Post(':id/opciones')
  addOpcion(@Param('id') id: string, @Body() dto: CreateModifierOptionDto) {
    return this.modifierGroupsService.addOpcion(id, dto);
  }

  // Registered before the plain ':id' routes below on purpose — Nest/Express
  // match routes in declaration order, and 'opciones/:optionId' would
  // otherwise never be reached because ':id' (same single-segment shape)
  // always matches first.
  @Roles(Role.GERENTE, Role.DUENO)
  @Patch('opciones/:optionId')
  updateOpcion(@Param('optionId') optionId: string, @Body() dto: UpdateModifierOptionDto) {
    return this.modifierGroupsService.updateOpcion(optionId, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Delete('opciones/:optionId')
  removeOpcion(@Param('optionId') optionId: string) {
    return this.modifierGroupsService.removeOpcion(optionId);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateModifierGroupDto) {
    return this.modifierGroupsService.update(id, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.modifierGroupsService.remove(id);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Post(':id/products/:productId')
  assignToProduct(@Param('id') id: string, @Param('productId') productId: string, @Body() dto: AssignModifierGroupDto) {
    return this.modifierGroupsService.assignToProduct(id, productId, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Delete(':id/products/:productId')
  unassignFromProduct(@Param('id') id: string, @Param('productId') productId: string) {
    return this.modifierGroupsService.unassignFromProduct(id, productId);
  }
}
