import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  findAll() {
    return this.promotionsService.findAll();
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Post()
  create(@Body() dto: CreatePromotionDto) {
    return this.promotionsService.create(dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotionsService.update(id, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.promotionsService.remove(id);
  }
}
