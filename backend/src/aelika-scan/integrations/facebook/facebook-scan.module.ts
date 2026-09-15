import { Module } from '@nestjs/common';
import { FacebookScanService } from './facebook-scan.service';

@Module({
  providers: [FacebookScanService],
  exports: [FacebookScanService],
})
export class FacebookScanModule {}
