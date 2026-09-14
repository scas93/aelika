import { Module } from '@nestjs/common';
import { GoogleMapsScanService } from './google-maps-scan.service';

@Module({
  providers: [GoogleMapsScanService],
  exports: [GoogleMapsScanService],
})
export class GoogleMapsScanModule {}
