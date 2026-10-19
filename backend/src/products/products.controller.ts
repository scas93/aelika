import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { R2StorageService } from '../common/r2-storage.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { MAX_IMAGEN_BYTES, validarImagen } from './product-image';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly storage: R2StorageService,
  ) {}

  // Sube la foto a R2 y regresa su URL; el cliente la manda después en `fotoUrl` al crear/editar el producto.
  // Va antes de `:id` para que "imagen" no se interprete como un id.
  @Roles(Role.GERENTE, Role.DUENO)
  @Post('imagen')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMAGEN_BYTES, files: 1 } }))
  async uploadImagen(@CurrentUser() user: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    const tipo = validarImagen(file);
    const url = await this.storage.upload(`productos/${user.tenantId}/${randomUUID()}.${tipo.ext}`, file!.buffer, tipo.mime);
    return { url };
  }

  @Get()
  findAll(@Query('categoryId') categoryId?: string) {
    return this.productsService.findAll(categoryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
