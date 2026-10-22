import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  EstadoPago,
  MetodoPago,
  Prisma,
  TipoOrden,
  TipoStorefront,
  type Tenant,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { recalcularContadoresCliente } from '../clientes/cliente-contadores';
import { bloquearClientes, buscarOCrearClienteReserva } from '../clientes/cliente-reserva';
import { parsearReservaAmenitiz, type ReservaNormalizada } from './amenitiz-reserva';

const PROVEEDOR = 'AMENITIZ';
const NOMBRE_SIN_DATO = 'Huésped';

export type ResultadoReserva = 'creada' | 'actualizada' | 'sin_cambios' | 'cancelada' | 'reactivada' | 'omitida_sin_telefono';

export interface RespuestaReserva {
  resultado: ResultadoReserva;
  ordenId: string | null;
  folio: string | null;
  cancelada: boolean | null;
}

const incluirDetalle = { detalleReserva: true } satisfies Prisma.OrderInclude;
type OrdenConDetalle = Prisma.OrderGetPayload<{ include: typeof incluirDetalle }>;

/**
 * Espejo de solo lectura de las reservas de un PMS (hoy Amenitiz). Guardar o actualizar una reserva NO dispara ningún
 * efecto (Telegram, correo, reglas, Stripe): aquí solo se escribe Order + DetalleReserva y se mantiene el Cliente.
 * Idempotente: todo el procesamiento de UNA reserva corre bajo un candado de Postgres por (negocio, id del PMS), así que
 * llamadas simultáneas con la misma reserva se serializan y nunca duplican.
 */
@Injectable()
export class ReservasService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestarAmenitiz(tenant: Tenant, body: unknown): Promise<RespuestaReserva> {
    if (tenant.tipoStorefront !== TipoStorefront.HOTEL) {
      throw new ForbiddenException('Este negocio no es un hotel: no acepta reservas');
    }
    const r = parsearReservaAmenitiz(body);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenant.id}:reserva:${PROVEEDOR}:${r.pmsReservaId}`}))`;
      const existente = await tx.order.findFirst({
        where: {
          tenantId: tenant.id,
          tipo: TipoOrden.RESERVA,
          detalleReserva: { pmsProveedor: PROVEEDOR, pmsReservaId: r.pmsReservaId },
        },
        include: incluirDetalle,
      });
      return existente ? this.actualizar(tx, tenant.id, r, existente) : this.crear(tx, tenant.id, r);
    });
  }

  private async crear(tx: Prisma.TransactionClient, tenantId: string, r: ReservaNormalizada): Promise<RespuestaReserva> {
    // Sin teléfono utilizable no hay Cliente ni a quién notificar: la reserva no se guarda (no es un error).
    if (!r.telefono) return { resultado: 'omitida_sin_telefono', ordenId: null, folio: null, cancelada: null };

    const nombre = r.nombre ?? NOMBRE_SIN_DATO;
    const { cliente } = await buscarOCrearClienteReserva(tx, { tenantId, telefono: r.telefono, nombre, correo: r.correo });
    await bloquearClientes(tx, [cliente.id]);
    // Mismo comportamiento de nombre/correo que un pedido: el último escrito para ese teléfono gana.
    await tx.cliente.update({ where: { id: cliente.id }, data: { nombre, ...(r.correo ? { correo: r.correo } : {}) } });

    const orden = await tx.order.create({
      data: {
        tenantId,
        tipo: TipoOrden.RESERVA,
        folio: r.pmsReservaId,
        clienteId: cliente.id,
        clienteNombre: nombre,
        clienteTelefono: r.telefono,
        clienteCorreo: r.correo,
        // El cobro vive en el PMS: Aelika no lo registra ni lo confirma (mismo criterio que B2B: no PAGADO).
        metodoPago: MetodoPago.EXTERNO,
        estadoPago: EstadoPago.PENDIENTE,
        total: r.total,
        cancelado: r.cancelada,
        canceladoAt: r.cancelada ? new Date() : null,
        detalleReserva: {
          create: {
            tenantId,
            pmsProveedor: PROVEEDOR,
            pmsReservaId: r.pmsReservaId,
            checkIn: r.checkIn,
            checkOut: r.checkOut,
            adultos: r.adultos,
            ninos: r.ninos,
            habitaciones: r.habitaciones,
            origen: r.origen,
            moneda: r.moneda,
            idiomaHuesped: r.idiomaHuesped,
            onlineCheckinUrl: r.onlineCheckinUrl,
          },
        },
      },
    });
    await recalcularContadoresCliente(tx, cliente.id);
    return { resultado: 'creada', ordenId: orden.id, folio: orden.folio, cancelada: r.cancelada };
  }

  private async actualizar(
    tx: Prisma.TransactionClient,
    tenantId: string,
    r: ReservaNormalizada,
    ex: OrdenConDetalle,
  ): Promise<RespuestaReserva> {
    const det = ex.detalleReserva!;

    // Contacto: con teléfono utilizable se aplica lo que llega; sin él se conserva TODO el contacto guardado.
    const telefono = r.telefono ?? ex.clienteTelefono;
    const nombre = r.telefono ? (r.nombre ?? ex.clienteNombre) : ex.clienteNombre;
    const correo = r.telefono ? (r.correo ?? ex.clienteCorreo) : ex.clienteCorreo;
    const cambioTelefono = telefono !== ex.clienteTelefono;

    const cambiosOrden: Prisma.OrderUncheckedUpdateInput = {};
    if (nombre !== ex.clienteNombre) cambiosOrden.clienteNombre = nombre;
    if (correo !== ex.clienteCorreo) cambiosOrden.clienteCorreo = correo;
    if (cambioTelefono) cambiosOrden.clienteTelefono = telefono;
    if (Number(ex.total) !== Number(r.total)) cambiosOrden.total = r.total;

    const cambioCancelacion = ex.cancelado !== r.cancelada;
    if (cambioCancelacion) {
      cambiosOrden.cancelado = r.cancelada;
      cambiosOrden.canceladoAt = r.cancelada ? new Date() : null;
    }

    const cambiosDetalle: Prisma.DetalleReservaUncheckedUpdateInput = {};
    if (det.checkIn.getTime() !== r.checkIn.getTime()) cambiosDetalle.checkIn = r.checkIn;
    if (det.checkOut.getTime() !== r.checkOut.getTime()) cambiosDetalle.checkOut = r.checkOut;
    if (det.adultos !== r.adultos) cambiosDetalle.adultos = r.adultos;
    if (det.ninos !== r.ninos) cambiosDetalle.ninos = r.ninos;
    if (det.habitaciones !== r.habitaciones) cambiosDetalle.habitaciones = r.habitaciones;
    if (det.origen !== r.origen) cambiosDetalle.origen = r.origen;
    if (det.moneda !== r.moneda) cambiosDetalle.moneda = r.moneda;
    if (det.idiomaHuesped !== r.idiomaHuesped) cambiosDetalle.idiomaHuesped = r.idiomaHuesped;
    if (det.onlineCheckinUrl !== r.onlineCheckinUrl) cambiosDetalle.onlineCheckinUrl = r.onlineCheckinUrl;

    const hayCambios = Object.keys(cambiosOrden).length > 0 || Object.keys(cambiosDetalle).length > 0;
    const base = { ordenId: ex.id, folio: ex.folio, cancelada: r.cancelada };
    if (!hayCambios) return { resultado: 'sin_cambios', ...base };

    // Cliente: si cambió el teléfono se re-liga al otro Cliente; si solo cambió nombre/correo se actualiza el actual.
    let clienteId = ex.clienteId;
    if (cambioTelefono) {
      const { cliente } = await buscarOCrearClienteReserva(tx, { tenantId, telefono, nombre, correo });
      clienteId = cliente.id;
      cambiosOrden.clienteId = clienteId;
    }
    await bloquearClientes(tx, [ex.clienteId, clienteId]);
    if (cambioTelefono || nombre !== ex.clienteNombre || correo !== ex.clienteCorreo) {
      await tx.cliente.update({ where: { id: clienteId }, data: { nombre, ...(correo ? { correo } : {}) } });
    }

    if (Object.keys(cambiosOrden).length > 0) await tx.order.update({ where: { id: ex.id }, data: cambiosOrden });
    if (Object.keys(cambiosDetalle).length > 0) await tx.detalleReserva.update({ where: { orderId: ex.id }, data: cambiosDetalle });

    if (cambioCancelacion || clienteId !== ex.clienteId) {
      await recalcularContadoresCliente(tx, clienteId);
      if (clienteId !== ex.clienteId) await recalcularContadoresCliente(tx, ex.clienteId);
    }

    const resultado: ResultadoReserva = !cambioCancelacion ? 'actualizada' : r.cancelada ? 'cancelada' : 'reactivada';
    return { resultado, ...base };
  }
}
