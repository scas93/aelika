import { JwtService } from '@nestjs/jwt';

/** JWT de prueba firmado con el mismo secreto que usa la app (setup-env.ts). */
export function tokenFor(
  jwt: JwtService,
  user: { id: string; email: string },
  tenantId: string,
  rol: 'DUENO' | 'GERENTE' | 'OPERADOR',
): string {
  return jwt.sign({ sub: user.id, tenantId, email: user.email, rol });
}
