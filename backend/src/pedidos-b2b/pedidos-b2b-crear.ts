import { ConflictException } from '@nestjs/common';
import { Prisma, TipoOrden } from '../../generated/prisma/client';
import { round2 } from '../common/money';
import { recalcularContadoresCliente } from '../clientes/cliente-contadores';
import { crearOrdenB2b } from './pedidos-b2b-orden';
import { nextFolioPedidoB2b, type ItemsResueltos } from './pedidos-b2b-logica';

/**
 * Creación de un pedido B2B de un cliente, compartida por el panel (PedidosB2bService.create) y el portal del cliente
 * (PortalPedidosService, Fase 4). Siempre dentro de una transacción del llamador:
 *   1. `bloquearClienteB2b` toma el FOR UPDATE del cliente (primer candado).
 *   2. `crearPedidoB2bDeCliente` revisa "un pedido por cliente por semana", asigna folio (segundo candado: advisory lock
 *      por negocio) y crea la orden. El orden de bloqueos es siempre cliente → folio.
 * Un portal que crea dos semanas llama a (2) dos veces dentro de la MISMA transacción: todo o nada.
 */

export async function bloquearClienteB2b(
  tx: Prisma.TransactionClient,
  tenantId: string,
  clienteId: string,
) {
  await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${clienteId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  // Se lee de nuevo ya con el candado: baja, descuento y modalidad son los vigentes en este instante.
  const cliente = await tx.cliente.findFirstOrThrow({
    where: { id: clienteId, tenantId },
    include: { telefonos: { where: { principal: true }, take: 1 } },
  });
  if (cliente.bajaAt) {
    throw new ConflictException(
      'El cliente está dado de baja: no puede tener pedidos nuevos',
    );
  }
  const principal = cliente.telefonos[0];
  if (!principal) {
    throw new ConflictException(
      'El cliente no tiene un teléfono principal: agrégalo antes de capturar el pedido',
    );
  }
  return { cliente, principal };
}

export interface ParamsCrearPedidoB2b {
  tenantId: string;
  tenant: {
    pedidoB2bModoCobro: Prisma.DetalleB2BUncheckedCreateInput['modoCobro'];
    pedidoB2bMinimoPiezas: number;
  };
  cliente: Awaited<ReturnType<typeof bloquearClienteB2b>>['cliente'];
  principal: Awaited<ReturnType<typeof bloquearClienteB2b>>['principal'];
  semanaInicio: Date;
  resueltos: ItemsResueltos;
  totalPiezas: number;
  subtotal: number;
  notaCliente?: string | null;
  /** Mensaje del 409 cuando el cliente ya tiene pedido esa semana (el del panel por defecto). */
  mensajeExistente?: (folio: string) => string;
}

export async function crearPedidoB2bDeCliente(
  tx: Prisma.TransactionClient,
  p: ParamsCrearPedidoB2b,
) {
  const { cliente, principal, tenantId, tenant, semanaInicio } = p;

  const existente = await tx.order.findFirst({
    where: {
      tipo: TipoOrden.B2B,
      clienteId: cliente.id,
      cancelado: false,
      detalleB2b: { semanaInicio },
    },
    select: { id: true, folio: true },
  });
  if (existente) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: p.mensajeExistente
        ? p.mensajeExistente(existente.folio)
        : `Este cliente ya tiene el pedido ${existente.folio} para esa semana. Para agregar o cambiar entregas, edita ese pedido.`,
      folio: existente.folio,
      pedidoId: existente.id,
    });
  }

  const descuentoPorcentaje = cliente.descuentoPorcentaje
    ? Number(cliente.descuentoPorcentaje)
    : null;
  const descuentoTotal = descuentoPorcentaje
    ? round2(p.subtotal * (descuentoPorcentaje / 100))
    : 0;
  const total = round2(p.subtotal - descuentoTotal);
  const folio = await nextFolioPedidoB2b(tx, tenantId);

  const orden = await crearOrdenB2b(
    tx,
    {
      tenantId,
      folio,
      clienteId: cliente.id,
      negocioNombre: cliente.nombre,
      contactoNombre: principal.nombreContacto ?? cliente.nombre,
      contactoTelefono: principal.telefono,
      contactoCorreo: cliente.correo,
      semanaInicio,
      modoCobro: cliente.modalidadPago ?? tenant.pedidoB2bModoCobro,
      minimoPiezasAplicado: tenant.pedidoB2bMinimoPiezas,
      totalPiezas: p.totalPiezas,
      subtotal: p.subtotal,
      descuentoTotal,
      total,
      // El descuento del cliente no es un código: solo se guarda el % aplicado.
      codigoDescuentoId: null,
      codigoDescuentoTexto: null,
      descuentoPorcentajeAplicado: descuentoPorcentaje,
      notaCliente: p.notaCliente?.trim() || null,
    },
    p.resueltos,
  );

  // Un pedido B2B cuenta desde que nace (cancelado = false), sin depender de estadoPago.
  await recalcularContadoresCliente(tx, cliente.id);

  return {
    id: orden.id,
    folio,
    subtotal: p.subtotal,
    descuentoTotal,
    total,
    descuentoPorcentaje,
  };
}
