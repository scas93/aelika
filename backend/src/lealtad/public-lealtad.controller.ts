import { Body, Controller, Param, Post } from '@nestjs/common';
import { PublicLealtadService } from './public-lealtad.service';
import { AltaClienteLealtadDto } from './dto/alta-cliente-lealtad.dto';
import { Public } from '../auth/decorators/public.decorator';

// Auto-registro público de Lealtad — mismo patrón que
// PublicPedidosB2bController (pedidos-b2b/): @Public() a nivel de clase,
// tenant resuelto por slug, sin JWT. Prefijo propio (public/lealtad/...)
// para no tocar/chocar con las rutas de PublicController (public/tenants/...).
// Sin PIN — el PIN protege registrar-compra/redimir-premio, no la alta (ver
// LealtadController).
@Public()
@Controller('public/lealtad')
export class PublicLealtadController {
  constructor(private readonly publicLealtadService: PublicLealtadService) {}

  @Post('tenants/:slug/clientes')
  altaCliente(@Param('slug') slug: string, @Body() dto: AltaClienteLealtadDto) {
    return this.publicLealtadService.altaCliente(slug, dto.nombre, dto.telefono);
  }
}
