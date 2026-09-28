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
