import { Module } from '@nestjs/common';
import { InstagramScanService } from './instagram-scan.service';

@Module({
  providers: [InstagramScanService],
  exports: [InstagramScanService],
})
export class InstagramScanModule {}
