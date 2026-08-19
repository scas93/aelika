import { JwtPayload } from './jwt-payload.type';
import type { Tenant } from '../../../generated/prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      tenant?: Tenant;
    }
  }
}
