import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizarHorarioSemana } from '../common/horario';
import { generateApiKey } from '../common/api-key';
import { resolverMensajeBienvenida } from '../common/mensaje-bienvenida';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import type { FacturacionModo } from '../../generated/prisma/enums';

const SETTINGS_SELECT = {
  nombre: true,
  mensajeBienvenida: true,
  horarioAtencion: true,
  ubicacion: true,
  botApiKey: true,
  facturacionModo: true,
} as const;

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: SETTINGS_SELECT,
    });
    return this.present(tenant);
  }

  async updateMine(tenantId: string, dto: UpdateTenantDto) {
    // botApiKey (like slug/nombre) is intentionally absent from UpdateTenantDto,
    // so there's nothing to strip here — the global ValidationPipe's whitelist
    // already drops it if a client sends it. Regeneration is a separate,
    // deliberate action (see regenerateBotKey), not a side effect of a
    // routine settings save.
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        // Normalize a cleared textarea back to null instead of storing "",
        // so getMine() re-applies the default next time instead of showing blank.
        mensajeBienvenida: dto.mensajeBienvenida !== undefined ? dto.mensajeBienvenida.trim() || null : undefined,
        horarioAtencion: dto.horarioAtencion ? (normalizarHorarioSemana(dto.horarioAtencion) as any) : undefined,
        ubicacion: dto.ubicacion,
        facturacionModo: dto.facturacionModo,
      },
      select: SETTINGS_SELECT,
    });
    return this.present(tenant);
  }

  async regenerateBotKey(tenantId: string) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { botApiKey: generateApiKey() },
      select: SETTINGS_SELECT,
    });
    return this.present(tenant);
  }

  private present(tenant: {
    nombre: string;
    mensajeBienvenida: string | null;
    horarioAtencion: unknown;
    ubicacion: string | null;
    botApiKey: string;
    facturacionModo: FacturacionModo;
  }) {
    return {
      nombre: tenant.nombre,
      mensajeBienvenida: resolverMensajeBienvenida(tenant.mensajeBienvenida),
      horarioAtencion: tenant.horarioAtencion,
      ubicacion: tenant.ubicacion,
      botApiKey: tenant.botApiKey,
      facturacionModo: tenant.facturacionModo,
    };
  }
}
