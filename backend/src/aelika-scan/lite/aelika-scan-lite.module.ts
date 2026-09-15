import { Module } from '@nestjs/common';
import { GoogleMapsScanModule } from '../integrations/google-maps';
import { SitioWebScanModule } from '../integrations/sitio-web';
import { InstagramScanModule } from '../integrations/instagram';
import { FacebookScanModule } from '../integrations/facebook';
import { NapScanModule } from '../integrations/nap';
import { AelikaScanLiteController } from './aelika-scan-lite.controller';
import { AelikaScanLiteService } from './aelika-scan-lite.service';

@Module({
  imports: [
    GoogleMapsScanModule,
    SitioWebScanModule,
    InstagramScanModule,
    FacebookScanModule,
    NapScanModule,
  ],
  controllers: [AelikaScanLiteController],
  providers: [AelikaScanLiteService],
})
export class AelikaScanLiteModule {}
