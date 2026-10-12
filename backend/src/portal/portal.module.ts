import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CODIGOS_STORE, RedisCodigosStore } from './codigos-store';
import { EnviarCodigoAccesoService } from './enviar-codigo-acceso.service';
import { PortalAccesoController } from './portal-acceso.controller';
import { PortalAccesoService } from './portal-acceso.service';
import { PortalCalendarioController } from './portal-calendario.controller';
import { PortalCatalogoService } from './portal-catalogo.service';
import { PortalFavoritoService } from './portal-favorito.service';
import { PortalMisPedidosService } from './portal-mis-pedidos.service';
import { PortalPedidosController } from './portal-pedidos.controller';
import { PortalPedidosService } from './portal-pedidos.service';
import { PortalCalendarioService } from './portal-calendario.service';

@Module({
  controllers: [
    PortalAccesoController,
    PortalCalendarioController,
    PortalPedidosController,
  ],
  providers: [
    PortalAccesoService,
    PortalCalendarioService,
    PortalCatalogoService,
    PortalFavoritoService,
    PortalPedidosService,
    PortalMisPedidosService,
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
