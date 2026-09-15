import { Module } from '@nestjs/common';
import { NapScanService } from './nap-scan.service';

@Module({
  providers: [NapScanService],
  exports: [NapScanService],
})
export class NapScanModule {}
