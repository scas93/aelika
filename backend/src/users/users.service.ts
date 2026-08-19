import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { Role } from '../../generated/prisma/enums';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { generateTemporaryPassword } from './generate-temporary-password';

const SALT_ROUNDS = 10;
const SAFE_SELECT = { id: true, nombre: true, email: true, rol: true, activo: true, createdAt: true } as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  findAll() {
    return this.tenantPrisma.client.user.findMany({
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateUserDto) {
    // Email is unique across all tenants (see AuthService.register), so this
    // check has to run against the raw, un-scoped client.
    const emailTaken = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (emailTaken) {
      throw new ConflictException('Ese correo ya está registrado');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, SALT_ROUNDS);

    const user = await this.tenantPrisma.client.user.create({
      // tenantId is required by the generated types but injected at runtime
      // by the tenant-scoped query extension (see TenantPrismaService).
      data: { nombre: dto.nombre, email: dto.email, rol: dto.rol, passwordHash, activo: true } as any,
      select: SAFE_SELECT,
    });

    return { ...user, temporaryPassword };
  }

  async update(currentUserId: string, id: string, dto: UpdateUserDto) {
    if (id === currentUserId) {
      throw new ForbiddenException('No puedes editarte a ti mismo desde aquí');
    }

    const target = await this.tenantPrisma.client.user.findUnique({ where: { id } });
    if (!target) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const nextRol = dto.rol ?? target.rol;
    const nextActivo = dto.activo ?? target.activo;
    const wasActiveDueno = target.rol === Role.DUENO && target.activo;
    const staysActiveDueno = nextRol === Role.DUENO && nextActivo;

    if (wasActiveDueno && !staysActiveDueno) {
      const otherActiveDuenos = await this.tenantPrisma.client.user.count({
        where: { rol: Role.DUENO, activo: true, id: { not: id } },
      });
      if (otherActiveDuenos === 0) {
        throw new ConflictException('El tenant debe tener al menos un dueño activo');
      }
    }

    return this.tenantPrisma.client.user.update({
      where: { id },
      data: { rol: dto.rol, activo: dto.activo },
      select: SAFE_SELECT,
    });
  }
}
