import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { R2StorageService } from '../common/r2-storage.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, R2StorageService],
})
export class ProductsModule {}
