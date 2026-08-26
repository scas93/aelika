import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import type { Tenant } from '../../../generated/prisma/client';

// Set by BotAuthGuard — routes using this decorator must also use that guard.
export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Tenant => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.tenant as Tenant;
  },
);
