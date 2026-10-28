import { telefonoParaEnvio } from '../../common/telefono-internacional';
import { sanitizarParaMeta } from '../../notificaciones-reglas/plantilla-variable-formato';

/** Plantilla fija del aviso (aprobada en Meta). No es configurable por negocio. */
export const PLANTILLA_AVISO = { nombre: 'pedido_modificado_cliente', idioma: 'es_MX' } as const;
export const CATEGORIA_AVISO = 'UTILITY';
export const TIPO_AVISO = 'AVISO_INTERNO';
/** Ruta (sin dominio ni "/" inicial) que abre el pedido en el panel. El dominio va fijo en la plantilla de Meta. */
export const RUTA_PEDIDO_PANEL = 'dashboard/pedidos-b2b?pedido=';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «26 de octubre»: componentes UTC (la semana es una fecha sin hora) y mes en minúsculas, sin año. */
export function fechaSemanaEnEspanol(semanaInicio: Date): string {
  return `${semanaInicio.getUTCDate()} de ${MESES[semanaInicio.getUTCMonth()]}`;
}

/** Últimos 4 dígitos de un teléfono guardado: lo único del número que se persiste. */
export function ultimos4(telefono: string): string {
  return telefono.replace(/\D/g, '').slice(-4);
}

export interface DatosPayloadAviso {
  correlacionId: string;
  negocioSlug: string;
  telefonoGuardado: string;
  negocioNombre: string;
  semanaInicio: Date;
  orderId: string;
}

/** Payload exacto del POST a Botpress (contrato 5.1). El valor del botón NO se sanea: es ruta fija + id. */
export function construirPayloadAviso(d: DatosPayloadAviso) {
  return {
    tipo: TIPO_AVISO,
    correlacionId: d.correlacionId,
    negocio: d.negocioSlug,
    telefono: telefonoParaEnvio(d.telefonoGuardado),
    categoria: CATEGORIA_AVISO,
    plantilla: { nombre: PLANTILLA_AVISO.nombre, idioma: PLANTILLA_AVISO.idioma },
    variables: [sanitizarParaMeta(d.negocioNombre, '—'), fechaSemanaEnEspanol(d.semanaInicio)],
    boton: { tipo: 'URL_DINAMICA', indice: 0, valor: `${RUTA_PEDIDO_PANEL}${d.orderId}` },
  };
}
