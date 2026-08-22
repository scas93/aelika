import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tenant } from '../../generated/prisma/client';
import { isAbiertoAhora, HorarioSemana } from '../common/horario';
import { resolverMensajeBienvenida } from '../common/mensaje-bienvenida';

const STOREFRONT_BASE_URL_DEFAULT = 'http://localhost:3000/tienda';

@Injectable()
export class InternalService {
  constructor(private readonly configService: ConfigService) {}

  getBotConfig(tenant: Tenant) {
    const storefrontBaseUrl = this.configService.get<string>('STOREFRONT_BASE_URL') ?? STOREFRONT_BASE_URL_DEFAULT;

    return {
      nombre: tenant.nombre,
      mensajeBienvenida: resolverMensajeBienvenida(tenant.mensajeBienvenida),
      abierto: isAbiertoAhora(tenant.horarioAtencion as HorarioSemana | null),
      ubicacion: tenant.ubicacion,
      catalogoUrl: `${storefrontBaseUrl}/${tenant.slug}`,
    };
  }
}
