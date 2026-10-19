import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';
import { TenantB2bPanelGuard } from '../pedidos-b2b/tenant-b2b.guard';
import { AdopcionService } from './adopcion.service';

class SemanaQueryDto {
  /** Lunes de la semana (YYYY-MM-DD). Sin valor: la próxima semana. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  semana?: string;
}

// Módulo Adopción: solo lectura, solo Dueño y solo negocios de mayoreo (mismo guard que el resto de los pedidos B2B).
@Roles(Role.DUENO)
@UseGuards(TenantB2bPanelGuard)
@Controller('adopcion')
export class AdopcionController {
  constructor(private readonly adopcion: AdopcionService) {}

  @Get('clientes')
  clientes(@Query() q: SemanaQueryDto) {
    return this.adopcion.clientes(q.semana);
  }

  @Get('interno')
  interno() {
    return this.adopcion.interno();
  }
}
