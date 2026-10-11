import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CODIGOS_STORE, RedisCodigosStore } from './codigos-store';
import { EnviarCodigoAccesoService } from './enviar-codigo-acceso.service';
import { PortalAccesoController } from './portal-acceso.controller';
import { PortalAccesoService } from './portal-acceso.service';

@Module({
  controllers: [PortalAccesoController],
  providers: [
    PortalAccesoService,
    EnviarCodigoAccesoService,
    {
      provide: CODIGOS_STORE,
      useFactory: (config: ConfigService) =>
        new RedisCodigosStore(config.getOrThrow<string>('REDIS_URL')),
      inject: [ConfigService],
    },
  ],
})
export class PortalModule {}
