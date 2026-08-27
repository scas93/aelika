import { BadRequestException } from '@nestjs/common';
import { DiaSemana } from '../../generated/prisma/enums';
import { diaActualMexico, horaActualMexico } from './horario';
import { VentanaRecepcionB2bDto } from './dto/ventana-recepcion-b2b.dto';

/**
 * Ventana semanal recurrente en la que el storefront público de mayoreo
 * (/mayoreo/[slug]) acepta pedidos nuevos — ver Tenant.pedidoB2bVentana* en
 * schema.prisma. Reemplaza a HorarioSemana/isAbiertoAhora para ese módulo
 * únicamente; no toca HorarioSemana en sí ni su uso en /tienda (B2C).
 */
export interface VentanaRecepcionB2b {
  aperturaDia: DiaSemana;
  aperturaHora: string;
  cierreDia: DiaSemana;
  cierreHora: string;
}

// Orden fijo lunes-domingo — mismo orden que DIAS_EN_ORDEN en
// pedidos-b2b-logica.ts, duplicado aquí a propósito: ese archivo vive en el
// módulo pedidos-b2b/ y este en common/ (usado también por TenantService,
// fuera de ese módulo), no hay un import limpio entre ambos sin crear un
// ciclo de dependencias entre common/ y pedidos-b2b/.
const DIAS_EN_ORDEN: DiaSemana[] = [
  DiaSemana.LUNES,
  DiaSemana.MARTES,
  DiaSemana.MIERCOLES,
  DiaSemana.JUEVES,
  DiaSemana.VIERNES,
  DiaSemana.SABADO,
  DiaSemana.DOMINGO,
];

const DIA_LOWERCASE_A_ENUM: Record<string, DiaSemana> = {
  lunes: DiaSemana.LUNES,
  martes: DiaSemana.MARTES,
  miercoles: DiaSemana.MIERCOLES,
  jueves: DiaSemana.JUEVES,
  viernes: DiaSemana.VIERNES,
  sabado: DiaSemana.SABADO,
  domingo: DiaSemana.DOMINGO,
};

const DIA_LABEL: Record<DiaSemana, string> = {
  LUNES: 'lunes',
  MARTES: 'martes',
  MIERCOLES: 'miércoles',
  JUEVES: 'jueves',
  VIERNES: 'viernes',
  SABADO: 'sábado',
  DOMINGO: 'domingo',
};

/** Row shape as selected straight off Tenant — the 4 pedidoB2bVentana* columns. */
export interface TenantVentanaRecepcionRow {
  pedidoB2bVentanaAperturaDia: DiaSemana | null;
  pedidoB2bVentanaAperturaHora: string | null;
  pedidoB2bVentanaCierreDia: DiaSemana | null;
  pedidoB2bVentanaCierreHora: string | null;
}

/** null cuando el tenant no tiene ventana configurada — ver estaEnVentana. */
export function ventanaDesdeTenant(
  tenant: TenantVentanaRecepcionRow,
): VentanaRecepcionB2b | null {
  if (!tenant.pedidoB2bVentanaAperturaDia) {
    return null;
  }
  return {
    aperturaDia: tenant.pedidoB2bVentanaAperturaDia,
    aperturaHora: tenant.pedidoB2bVentanaAperturaHora!,
    cierreDia: tenant.pedidoB2bVentanaCierreDia!,
    cierreHora: tenant.pedidoB2bVentanaCierreHora!,
  };
}

/**
 * Normaliza/valida el input de PATCH /tenant/me para los 4 campos de
 * ventana — todo-o-nada (el DTO ya obliga a que, si se manda el objeto,
 * vengan los 4 campos). undefined significa "no tocar estos campos" (mismo
 * patrón que el resto de UpdateTenantDto); null significa "borrar la
 * ventana configurada" (vuelve a comportarse como siempre abierta).
 */
export function normalizarVentanaRecepcion(
  input: VentanaRecepcionB2bDto | null | undefined,
):
  | {
      pedidoB2bVentanaAperturaDia: DiaSemana | null;
      pedidoB2bVentanaAperturaHora: string | null;
      pedidoB2bVentanaCierreDia: DiaSemana | null;
      pedidoB2bVentanaCierreHora: string | null;
    }
  | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input === null) {
    return {
      pedidoB2bVentanaAperturaDia: null,
      pedidoB2bVentanaAperturaHora: null,
      pedidoB2bVentanaCierreDia: null,
      pedidoB2bVentanaCierreHora: null,
    };
  }

  const aperturaIndex = DIAS_EN_ORDEN.indexOf(input.aperturaDia);
  const cierreIndex = DIAS_EN_ORDEN.indexOf(input.cierreDia);

  if (aperturaIndex > cierreIndex) {
    throw new BadRequestException(
      'El día de apertura debe ser igual o anterior al día de cierre dentro de la semana — no se soportan ventanas que crucen domingo→lunes',
    );
  }
  if (aperturaIndex === cierreIndex && input.aperturaHora >= input.cierreHora) {
    throw new BadRequestException(
      'La hora de apertura debe ser antes que la de cierre cuando ambos días son el mismo',
    );
  }

  return {
    pedidoB2bVentanaAperturaDia: input.aperturaDia,
    pedidoB2bVentanaAperturaHora: input.aperturaHora,
    pedidoB2bVentanaCierreDia: input.cierreDia,
    pedidoB2bVentanaCierreHora: input.cierreHora,
  };
}

/**
 * ventana === null (sin configurar) siempre regresa true — nunca debe
 * bloquear la creación de un pedido por falta de configuración.
 */
export function estaEnVentana(
  ventana: VentanaRecepcionB2b | null,
  now = new Date(),
): boolean {
  if (!ventana) {
    return true;
  }

  const diaActualIndex = DIAS_EN_ORDEN.indexOf(
    DIA_LOWERCASE_A_ENUM[diaActualMexico(now)],
  );
  const horaActual = horaActualMexico(now);
  const aperturaIndex = DIAS_EN_ORDEN.indexOf(ventana.aperturaDia);
  const cierreIndex = DIAS_EN_ORDEN.indexOf(ventana.cierreDia);

  const yaAbrio =
    diaActualIndex > aperturaIndex ||
    (diaActualIndex === aperturaIndex && horaActual >= ventana.aperturaHora);
  const noHaCerrado =
    diaActualIndex < cierreIndex ||
    (diaActualIndex === cierreIndex && horaActual < ventana.cierreHora);

  return yaAbrio && noHaCerrado;
}

/** Solo se llama cuando estaEnVentana ya dio false para una ventana configurada. */
export function mensajeVentanaCerrada(ventana: VentanaRecepcionB2b): string {
  return `Este negocio no recibe pedidos en este momento — vuelve a abrir el ${DIA_LABEL[ventana.aperturaDia]} a las ${ventana.aperturaHora}.`;
}
