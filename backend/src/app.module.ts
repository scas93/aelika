import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { UsersModule } from './users/users.module';
import { PromotionsModule } from './promotions/promotions.module';
import { PublicModule } from './public/public.module';
import { OrdersModule } from './orders/orders.module';
import { TenantModule } from './tenant/tenant.module';
import { InternalModule } from './internal/internal.module';
import { PuntosEnvioModule } from './puntos-envio/puntos-envio.module';
import { ModifierGroupsModule } from './modifier-groups/modifier-groups.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    UsersModule,
    PromotionsModule,
    PublicModule,
    OrdersModule,
    TenantModule,
    InternalModule,
    PuntosEnvioModule,
    ModifierGroupsModule,
    WebhooksModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
