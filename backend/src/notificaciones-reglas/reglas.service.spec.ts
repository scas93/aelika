import { BadRequestException } from '@nestjs/common';
import { ReglasService } from './reglas.service';

function crearServicio() {
  // Los 4 colaboradores no los usa validarPlantillaVariables/catalogoVariables
  // (son puros respecto a sus argumentos) — dummies bastan, mismo criterio
  // que regla-envio.service.spec.ts.
  return new ReglasService({} as any, {} as any, {} as any, {} as any);
}

function validar(service: ReglasService, trigger: string, origen: string | undefined, raw: unknown[]) {
  // validarPlantillaVariables es privado — ver el comentario en
  // regla-envio.service.spec.ts sobre por qué se accede así en vez de pasar
  // por create()/update() (que exigirían mockear TenantPrismaService por
  // completo solo para llegar a esta validación).
  return (service as any).validarPlantillaVariables(trigger, origen, raw);
}

describe('ReglasService.validarPlantillaVariables — validación trigger/origen al guardar', () => {
  it('acepta las variables retrocompatibles (CAMPO_CLIENTE/nombre, NOMBRE_NEGOCIO/nombre) en cualquier trigger', async () => {
    const service = crearServicio();
    const resultado = await validar(service, 'ESTADO_CLIENTE', undefined, [
      { posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'nombre' },
      { posicion: 2, fuente: 'NOMBRE_NEGOCIO', valor: 'nombre' },
    ]);
    expect(resultado).toEqual([
      { posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'nombre' },
      { posicion: 2, fuente: 'NOMBRE_NEGOCIO', valor: 'nombre' },
    ]);
  });

  it('acepta cualquier texto para VALOR_FIJO sin consultar el catálogo', async () => {
    const service = crearServicio();
    const resultado = await validar(service, 'MANUAL', undefined, [{ posicion: 1, fuente: 'VALOR_FIJO', valor: 'Hola!' }]);
    expect(resultado).toEqual([{ posicion: 1, fuente: 'VALOR_FIJO', valor: 'Hola!' }]);
  });

  it('rechaza una variable de Pedido (folio) si el trigger no es EVENTO_PEDIDO', async () => {
    const service = crearServicio();
    await expect(
      validar(service, 'ESTADO_CLIENTE', undefined, [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }]),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validar(service, 'MANUAL', undefined, [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }]),
    ).rejects.toThrow(BadRequestException);
  });

  it('acepta una variable de Pedido (folio) con trigger EVENTO_PEDIDO, en cualquier origen', async () => {
    const service = crearServicio();
    await expect(
      validar(service, 'EVENTO_PEDIDO', 'ORDER', [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }]),
    ).resolves.toEqual([{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }]);
    await expect(
      validar(service, 'EVENTO_PEDIDO', 'PEDIDO_B2B', [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }]),
    ).resolves.toEqual([{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }]);
  });

  it('rechaza una variable "solo menudeo" (tipoEntrega) si el origen es PEDIDO_B2B', async () => {
    const service = crearServicio();
    await expect(
      validar(service, 'EVENTO_PEDIDO', 'PEDIDO_B2B', [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'tipoEntrega' }]),
    ).rejects.toThrow(BadRequestException);
  });

  it('acepta una variable "solo menudeo" (tipoEntrega) si el origen es ORDER', async () => {
    const service = crearServicio();
    await expect(
      validar(service, 'EVENTO_PEDIDO', 'ORDER', [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'tipoEntrega' }]),
    ).resolves.toEqual([{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'tipoEntrega' }]);
  });

  it('rechaza una combinación fuente/valor que no existe en el catálogo', async () => {
    const service = crearServicio();
    await expect(
      validar(service, 'ESTADO_CLIENTE', undefined, [{ posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'correo' }]),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ReglasService.catalogoVariables', () => {
  it('expone el catálogo sin la función resolver (no debe filtrarse al frontend)', () => {
    const service = crearServicio();
    const catalogo = service.catalogoVariables();
    expect(catalogo.length).toBeGreaterThan(0);
    for (const entrada of catalogo) {
      expect((entrada as any).resolver).toBeUndefined();
      expect(entrada.label).toEqual(expect.any(String));
      expect(entrada.ejemplo).toEqual(expect.any(String));
    }
  });
});
