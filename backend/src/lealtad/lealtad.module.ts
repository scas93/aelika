import { Module } from '@nestjs/common';
import { LealtadController } from './lealtad.controller';
import { LealtadService } from './lealtad.service';
import { PublicLealtadController } from './public-lealtad.controller';
import { PublicLealtadService } from './public-lealtad.service';
import { WalletPassService } from './wallet-pass.service';
import { LealtadPinGuard } from './guards/lealtad-pin.guard';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
  imports: [ClientesModule],
  controllers: [LealtadController, PublicLealtadController],
  providers: [LealtadService, PublicLealtadService, WalletPassService, LealtadPinGuard],
  exports: [LealtadService],
})
export class LealtadModule {}
