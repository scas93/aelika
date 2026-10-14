import { Module } from '@nestjs/common';
import { ClientesB2bController } from './clientes-b2b.controller';
import { ClientesB2bService } from './clientes-b2b.service';

@Module({
  controllers: [ClientesB2bController],
  providers: [ClientesB2bService],
})
export class ClientesB2bModule {}
