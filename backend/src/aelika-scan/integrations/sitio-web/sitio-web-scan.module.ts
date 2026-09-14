import { Module } from '@nestjs/common';
import { SitioWebScanService } from './sitio-web-scan.service';

@Module({
  providers: [SitioWebScanService],
  exports: [SitioWebScanService],
})
export class SitioWebScanModule {}
