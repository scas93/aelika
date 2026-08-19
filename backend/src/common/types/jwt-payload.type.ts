import { Role } from '../../../generated/prisma/enums';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  rol: Role;
}
