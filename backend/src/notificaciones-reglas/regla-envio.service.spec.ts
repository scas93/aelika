import { BadRequestException } from '@nestjs/common';
import { Cliente, Tenant } from '../../generated/prisma/client';
import { ReglaEnvioService } from './regla-envio.service';
import { PedidoContextoOrder, PlantillaVariable } from './plantilla-variable.type';

const tenant = {
  id: 'tenant-1',
  slug: 'masa-madre',
  nombre: 'Masa Madre',
  ubicacion: 'Chapultepec 45',
} as Tenant;

const cliente = {
  id: 'cliente-1',
  nombre: 'Ana López',
  totalPedidos: 7,
  ultimoPedidoAt: new Date('2026-09-06T12:00:00.000Z'),
  primerPedidoAt: new Date('2026-03-15T12:00:00.000Z'),
} as Cliente;

const contextoOrder: PedidoContextoOrder = {
  origen: 'ORDER',
  folio: 'A-1043',
  total: 1245.5,
  estatus: 'LISTO_ENTREGA',
  createdAt: new Date('2026-09-24T18:30:00.000Z'),
  items: [
    { nombreProducto: 'Concha', cantidad: 2 },
    { nombreProducto: 'Café americano', cantidad: 1 },
  ],
  metodoEntrega: 'RECOGER',
  direccionCalle: null,
  direccionNumero: null,
  direccionColonia: null,
  metodoPago: 'EFECTIVO',
};

function crearServicio() {
  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const service = new ReglaEnvioService({} as any, configService as any);
  return service;
}

function resolver(service: ReglaEnvioService, variables: PlantillaVariable[], contexto?: PedidoContextoOrder) {
  // resolverVariables es privado — mismo criterio de prueba que el resto del
  // repo para lógica sin efectos secundarios: se invoca vía acceso a
  // miembro privado en vez de duplicar la lógica de armado del payload
  // completo (enviar) solo para probar la resolución de variables.
  return (service as any).resolverVariables(variables, tenant, cliente, contexto);
}

describe('ReglaEnvioService.resolverVariables', () => {
  it('resuelve CAMPO_CLIENTE/nombre, NOMBRE_NEGOCIO/nombre y VALOR_FIJO (retrocompatibilidad)', () => {
    const service = crearServicio();
    const variables: PlantillaVariable[] = [
      { posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'nombre' },
      { posicion: 2, fuente: 'NOMBRE_NEGOCIO', valor: 'nombre' },
      { posicion: 3, fuente: 'VALOR_FIJO', valor: 'Gracias por tu compra' },
    ];
    expect(resolver(service, variables)).toEqual(['Ana López', 'Masa Madre', 'Gracias por tu compra']);
  });

  it('resuelve variables nuevas de Pedido con formato (dinero, estatus humano)', () => {
    const service = crearServicio();
    const variables: PlantillaVariable[] = [
      { posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'total' },
      { posicion: 2, fuente: 'CAMPO_PEDIDO', valor: 'estatus' },
      { posicion: 3, fuente: 'CAMPO_PEDIDO', valor: 'resumenProductos' },
    ];
    expect(resolver(service, variables, contextoOrder)).toEqual([
      '$1,245.50',
      'Listo para entrega',
      '2x Concha, 1x Café americano',
    ]);
  });

  it('resuelve negocio.link usando STOREFRONT_BASE_URL (o el default) + slug', () => {
    const service = crearServicio();
    const variables: PlantillaVariable[] = [{ posicion: 1, fuente: 'NOMBRE_NEGOCIO', valor: 'link' }];
    expect(resolver(service, variables)).toEqual(['http://localhost:3000/tienda/masa-madre']);
  });

  it('aplica el fallback de la variable cuando el dato no está disponible', () => {
    const service = crearServicio();
    const sinUbicacion = { ...tenant, ubicacion: null } as Tenant;
    const variables: PlantillaVariable[] = [{ posicion: 1, fuente: 'NOMBRE_NEGOCIO', valor: 'ubicacion' }];
    expect((service as any).resolverVariables(variables, sinUbicacion, cliente, undefined)).toEqual(['—']);
  });

  it('sanitiza el valor final (nunca vacío, sin saltos de línea) incluido VALOR_FIJO', () => {
    const service = crearServicio();
    const variables: PlantillaVariable[] = [{ posicion: 1, fuente: 'VALOR_FIJO', valor: '  \n\n  ' }];
    expect(resolver(service, variables)).toEqual(['—']);
  });

  it('rechaza CAMPO_PEDIDO sin contexto de pedido', () => {
    const service = crearServicio();
    const variables: PlantillaVariable[] = [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }];
    expect(() => resolver(service, variables, undefined)).toThrow(BadRequestException);
  });

  it('rechaza una variable "solo menudeo" (tipoEntrega) si el contexto es de PedidoB2b', () => {
    const service = crearServicio();
    const contextoB2b = { ...contextoOrder, origen: 'PEDIDO_B2B' } as any;
    const variables: PlantillaVariable[] = [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'tipoEntrega' }];
    expect(() => resolver(service, variables, contextoB2b)).toThrow(BadRequestException);
  });

  it('rechaza una combinación fuente/valor que no existe en el catálogo', () => {
    const service = crearServicio();
    const variables: PlantillaVariable[] = [{ posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'correo' } as PlantillaVariable];
    expect(() => resolver(service, variables)).toThrow(BadRequestException);
  });

  it('ordena por posición sin importar el orden del arreglo', () => {
    const service = crearServicio();
    const variables: PlantillaVariable[] = [
      { posicion: 2, fuente: 'NOMBRE_NEGOCIO', valor: 'nombre' },
      { posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'nombre' },
    ];
    expect(resolver(service, variables)).toEqual(['Ana López', 'Masa Madre']);
  });
});

describe('ReglaEnvioService · variables de la semana siguiente (recordatorio semanal)', () => {
  const contextoSemana = {
    origen: 'SEMANA' as const,
    semanaInicio: new Date('2026-11-09T00:00:00.000Z'),
    semanaFin: new Date('2026-11-15T00:00:00.000Z'),
  };
  const variables: PlantillaVariable[] = [
    { posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'nombre' },
    { posicion: 2, fuente: 'SEMANA_SIGUIENTE', valor: 'inicio' },
    { posicion: 3, fuente: 'SEMANA_SIGUIENTE', valor: 'fin' },
  ];

  it('nombre del cliente y rango legible en español, sin correrse un día por la zona horaria', () => {
    const service = crearServicio();
    expect((service as any).resolverVariables(variables, tenant, cliente, contextoSemana, 'es_MX')).toEqual([
      'Ana López',
      '9 de noviembre',
      '15 de noviembre',
    ]);
  });

  it('semana que cruza de mes', () => {
    const service = crearServicio();
    const cruce = { ...contextoSemana, semanaInicio: new Date('2026-11-30T00:00:00.000Z'), semanaFin: new Date('2026-12-06T00:00:00.000Z') };
    expect((service as any).resolverVariables(variables.slice(1), tenant, cliente, cruce, 'es_MX')).toEqual(['30 de noviembre', '6 de diciembre']);
  });

  it('se rechazan sin contexto de semana, y las de pedido se rechazan con contexto de semana', () => {
    const service = crearServicio();
    expect(() => (service as any).resolverVariables(variables.slice(1), tenant, cliente, undefined, 'es_MX')).toThrow(BadRequestException);
    expect(() =>
      (service as any).resolverVariables([{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }], tenant, cliente, contextoSemana, 'es_MX'),
    ).toThrow(BadRequestException);
    // Las de siempre (cliente, negocio) siguen funcionando con ese contexto.
    expect((service as any).resolverVariables([{ posicion: 1, fuente: 'NOMBRE_NEGOCIO', valor: 'nombre' }], tenant, cliente, contextoSemana, 'es_MX')).toEqual(['Masa Madre']);
  });
});

describe('ReglaEnvioService.enviar · payload hacia Botpress', () => {
  const tenantEnvio = { ...tenant, botWebhookUrl: 'http://localhost:9/hook', botWebhookSecret: null } as Tenant;
  const clienteB2c = { ...cliente, canal: 'B2C', telefono: '5512345678' } as Cliente;
  const reglaBase = {
    id: 'regla-1',
    plantillaNombre: 'pedido_confirmado',
    plantillaIdioma: 'es_MX',
    plantillaCategoria: 'UTILITY',
    plantillaVariables: [{ posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'nombre' }],
    botonUrlValor: null,
  } as any;

  function servicioConFetch() {
    const crear = jest.fn().mockResolvedValue({ id: 'log-1', estado: 'EN_CURSO' });
    const prisma = { reglaEnvioLog: { create: crear, update: jest.fn() } };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
    const service = new ReglaEnvioService(prisma as any, { get: jest.fn().mockReturnValue(undefined) } as any);
    const cuerpo = () => JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    return { service, crear, fetchMock, cuerpo };
  }
  afterEach(() => jest.restoreAllMocks());

  it('una regla sin botón manda exactamente el mismo contenido de siempre (sin la clave «boton»)', async () => {
    const { service, cuerpo } = servicioConFetch();
    await service.enviar(tenantEnvio, clienteB2c, reglaBase);
    expect(cuerpo()).toEqual({
      correlacionId: 'log-1',
      telefono: '+525512345678',
      plantilla: { nombre: 'pedido_confirmado', idioma: 'es_MX' },
      variables: ['Ana López'],
    });
    expect(Object.keys(cuerpo())).not.toContain('boton');
  });

  it('una regla con botón agrega boton { URL_DINAMICA, indice 0, valor } y nada más cambia', async () => {
    const { service, cuerpo } = servicioConFetch();
    await service.enviar(tenantEnvio, clienteB2c, { ...reglaBase, botonUrlValor: 'panaderia-banetto' });
    expect(cuerpo()).toEqual({
      correlacionId: 'log-1',
      telefono: '+525512345678',
      plantilla: { nombre: 'pedido_confirmado', idioma: 'es_MX' },
      variables: ['Ana López'],
      boton: { tipo: 'URL_DINAMICA', indice: 0, valor: 'panaderia-banetto' },
    });
  });

  it('la semana del recordatorio viaja al registro del envío (reserva por índice único) y solo ahí', async () => {
    const { service, crear } = servicioConFetch();
    const semana = new Date('2026-11-09T00:00:00.000Z');
    await service.enviar(tenantEnvio, clienteB2c, reglaBase, undefined, undefined, semana);
    expect(crear.mock.calls[0][0].data).toMatchObject({ reglaId: 'regla-1', clienteId: 'cliente-1', semanaInicio: semana });
    crear.mockClear();
    await service.enviar(tenantEnvio, clienteB2c, reglaBase);
    expect(Object.keys(crear.mock.calls[0][0].data)).not.toContain('semanaInicio');
  });

  it('si la reserva ya la tomó otro proceso (P2002) lanza antes del POST: no se envía nada', async () => {
    const { service, crear, fetchMock } = servicioConFetch();
    crear.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(service.enviar(tenantEnvio, clienteB2c, reglaBase, undefined, undefined, new Date('2026-11-09T00:00:00.000Z'))).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
