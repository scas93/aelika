import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Public()
  @Get('slug-availability')
  async slugAvailability(@Query('slug') slug: string) {
    const available = await this.authService.isSlugAvailable(
      (slug ?? '').toLowerCase(),
    );
    return { slug, available };
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    // tenant.nombre/tipoStorefront/slug van aquí (relation include, no una
    // query aparte) para que el dashboard los tenga sin una segunda
    // llamada. slug se agregó para el link/QR de auto-registro de Lealtad
    // (registrar-cliente-tab.tsx) — es el único lugar abierto a los 3 roles
    // que expone el tenant en sesión; GET /tenant/me también lo tiene pero
    // es @Roles(DUENO), no sirve para Operador/Gerente.
    const record = await this.tenantPrisma.client.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        tenantId: true,
        tenant: { select: { nombre: true, tipoStorefront: true, slug: true } },
      },
    });
    return record;
  }

  @Patch('change-password')
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
    return { success: true };
  }
}
