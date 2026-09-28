import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tenant } from '../../generated/prisma/client';
import { isAbiertoAhora, HorarioSemana } from '../common/horario';
import { resolverMensajeBienvenida } from '../common/mensaje-bienvenida';
import { buildStorefrontUrl } from '../common/storefront-url';

@Injectable()
export class InternalService {
  constructor(private readonly configService: ConfigService) {}

  getBotConfig(tenant: Tenant) {
    return {
      nombre: tenant.nombre,
      mensajeBienvenida: resolverMensajeBienvenida(tenant.mensajeBienvenida),
      abierto: isAbiertoAhora(tenant.horarioAtencion as HorarioSemana | null),
      ubicacion: tenant.ubicacion,
      catalogoUrl: buildStorefrontUrl(this.configService, tenant.slug),
    };
  }
}
