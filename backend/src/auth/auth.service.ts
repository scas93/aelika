import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../generated/prisma/enums';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from '../common/types/jwt-payload.type';
import { horarioSemanaVacio, normalizarHorarioSemana } from '../common/horario';
import { generateApiKey } from '../common/api-key';

const SALT_ROUNDS = 10;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async isSlugAvailable(slug: string): Promise<boolean> {
    if (!SLUG_PATTERN.test(slug) || slug.length < 3) {
      return false;
    }
    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    return !existing;
  }

  async register(dto: RegisterDto) {
    const [slugTaken, emailTaken] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { slug: dto.slug } }),
      this.prisma.user.findUnique({ where: { email: dto.email } }),
    ]);

    if (slugTaken) {
      throw new ConflictException('Ese slug ya está en uso');
    }
    if (emailTaken) {
      throw new ConflictException('Ese correo ya está registrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const horarioAtencion = dto.horarioAtencion
      ? normalizarHorarioSemana(dto.horarioAtencion)
      : horarioSemanaVacio();

    const tenant = await this.prisma.tenant.create({
      data: {
        slug: dto.slug,
        nombre: dto.nombreNegocio,
        tipoStorefront: dto.tipoStorefront,
        horarioAtencion: horarioAtencion as any,
        ubicacion: dto.ubicacion,
        botApiKey: generateApiKey(),
        users: {
          create: {
            nombre: dto.nombreDueno,
            email: dto.email,
            passwordHash,
            rol: Role.DUENO,
          },
        },
      },
      include: { users: true },
    });

    const user = tenant.users[0];
    return this.buildSession(user.id, tenant.id, user.email, user.rol);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.activo) {
      throw new UnauthorizedException('Este usuario está desactivado');
    }

    return this.buildSession(user.id, user.tenantId, user.email, user.rol);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  private buildSession(
    userId: string,
    tenantId: string,
    email: string,
    rol: Role,
  ) {
    const payload: JwtPayload = { sub: userId, tenantId, email, rol };
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: userId, tenantId, email, rol },
    };
  }
}
