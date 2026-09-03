import {
  Inject,
  Injectable,
  Scope,
  UnauthorizedException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from './prisma.service';
import type { JwtPayload } from '../common/types/jwt-payload.type';

/**
 * Every model below carries a `tenantId` column and must always be scoped to
 * the requesting tenant. When a new tenant-owned model is introduced
 * (CATEGORY, PRODUCT, ORDERS, ...), add a matching block here so every query
 * against it gets the tenant filter for free instead of relying on each call
 * site to remember it.
 */
function tenantScopedQuery(tenantId: string) {
  return async ({
    operation,
    args,
    query,
  }: {
    operation: string;
    args: any;
    query: (args: any) => Promise<any>;
  }) => {
    if (operation === 'create') {
      args.data = { ...args.data, tenantId };
    } else if (operation === 'createMany' && Array.isArray(args.data)) {
      args.data = args.data.map((item: any) => ({ ...item, tenantId }));
    } else {
      args.where = { ...args.where, tenantId };
    }
    return query(args);
  };
}

@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private extendedClient?: PrismaService;

  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Lazily builds the tenant-scoped client on first access, instead of in the
   * constructor, so this provider can be injected into controllers that also
   * serve unauthenticated routes (e.g. register/login) without those routes
   * failing before the JWT guard even runs.
   */
  get client(): PrismaService {
    if (!this.extendedClient) {
      const user = this.request.user as JwtPayload | undefined;
      if (!user?.tenantId) {
        throw new UnauthorizedException(
          'No se encontró el tenant en la sesión',
        );
      }

      const tenantId = user.tenantId;
      this.extendedClient = this.prisma.$extends({
        query: {
          user: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          category: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          product: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          promotion: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          order: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          orderItem: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          puntoEnvio: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          modifierGroup: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          modifierOption: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          payment: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          pedidoB2b: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          pedidoB2bItem: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          pedidoB2bItemDia: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          pedidoB2bCodigoDescuento: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          notificacionCanalConfig: {
            $allOperations: tenantScopedQuery(tenantId),
          },
          notificacionEventoConfig: {
            $allOperations: tenantScopedQuery(tenantId),
          },
        },
      }) as unknown as PrismaService;
    }
    return this.extendedClient;
  }
}
