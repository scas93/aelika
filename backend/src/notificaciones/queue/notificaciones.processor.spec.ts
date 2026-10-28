import type { Job } from 'bullmq';
import { NotificacionesProcessor } from './notificaciones.processor';
import type { NotificacionJobData } from './notificacion-job.type';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificacionProvidersRegistry } from '../providers/notificacion-providers.registry';

describe('NotificacionesProcessor · filas WhatsApp (Cambio B: solo configuración)', () => {
  it('un evento con un canal WhatsApp activo no rompe el job: se omite sin error y sin llamar a ningún proveedor', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        audiencia: 'NEGOCIO',
        canalConfig: {
          tipo: 'WHATSAPP',
          config: { destinatarios: [{ id: 'a', nombre: 'Ana', telefono: '5512345678' }] },
        },
      },
    ]);
    const get = jest.fn();
    const processor = new NotificacionesProcessor(
      { notificacionEventoConfig: { findMany } } as unknown as PrismaService,
      { get } as unknown as NotificacionProvidersRegistry,
    );
    const job = {
      id: '1',
      data: { tenantId: 't', evento: 'PEDIDO_MODIFICADO_CLIENTE', mensaje: { texto: 'x' } },
    } as unknown as Job<NotificacionJobData>;

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });
});
