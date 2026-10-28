import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantNegocioController } from './tenant-negocio.controller';
import { TenantService } from './tenant.service';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [StripeModule],
  controllers: [TenantController, TenantNegocioController],
  providers: [TenantService],
})
export class TenantModule {}
