import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { normalizarTelefonoInternacional } from '../common/telefono-internacional';

/** Máximo de destinatarios de avisos internos por WhatsApp de un negocio. */
export const MAX_DESTINATARIOS_WHATSAPP = 10;
export const MAX_NOMBRE_DESTINATARIO = 60;

export interface DestinatarioWhatsapp {
  /** Estable: lo conserva la edición para que el registro de envíos pueda referirse al destinatario. */
  id: string;
  nombre: string;
  /** Normalizado: 10 dígitos (México, sin "+") o "+" + código de país + número (otros países). Ver telefonoParaEnvio. */
  telefono: string;
}

export interface ConfigWhatsapp {
  destinatarios: DestinatarioWhatsapp[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARACTERES_TELEFONO = /^\+?[\d\s\-().]+$/;
const MENSAJE_TELEFONO =
  'El teléfono debe tener 10 dígitos (México) o empezar con + y llevar el código de país (de 8 a 15 dígitos)';

/**
 * Teléfono de un destinatario → forma de guardado. Más estricto que `normalizarTelefonoInternacional` a propósito: sin "+"
 * solo se aceptan exactamente 10 dígitos (México); cualquier otro país exige "+". `+52…` y `+521…` quedan en 10 dígitos.
 */
export function normalizarTelefonoDestinatario(crudo: unknown): string {
  if (typeof crudo !== 'string' || !CARACTERES_TELEFONO.test(crudo.trim())) {
    throw new BadRequestException(MENSAJE_TELEFONO);
  }
  const texto = crudo.trim();
  const digitos = texto.replace(/\D/g, '');
  if (!texto.startsWith('+') && digitos.length !== 10) {
    throw new BadRequestException(MENSAJE_TELEFONO);
  }
  const normalizado = normalizarTelefonoInternacional(texto);
  if (!normalizado) throw new BadRequestException(MENSAJE_TELEFONO);
  return normalizado;
}

/**
 * ÚNICO lugar donde se valida el `config` de un canal WHATSAPP (alta y edición). Devuelve la forma canónica; cualquier otra
 * llave del objeto se descarta. Las ids se conservan si llegan válidas y no se repiten; si no, se generan. Solo valida forma
 * y límites (máximo 10, nombres, teléfonos, repetidos ya normalizados); la regla de "activo exige al menos 1" es del servicio.
 */
export function validarConfigWhatsapp(config: unknown): ConfigWhatsapp {
  const lista = (config as { destinatarios?: unknown } | null)?.destinatarios;
  if (!Array.isArray(lista)) {
    throw new BadRequestException('El canal de WhatsApp necesita la lista de destinatarios');
  }
  if (lista.length > MAX_DESTINATARIOS_WHATSAPP) {
    throw new BadRequestException(`Máximo ${MAX_DESTINATARIOS_WHATSAPP} destinatarios`);
  }
  const telefonos = new Set<string>();
  const ids = new Set<string>();
  const destinatarios = lista.map((raw: unknown, i) => {
    const d = (raw ?? {}) as { id?: unknown; nombre?: unknown; telefono?: unknown };
    const nombre = typeof d.nombre === 'string' ? d.nombre.trim() : '';
    if (!nombre) throw new BadRequestException(`El destinatario ${i + 1} necesita un nombre`);
    if (nombre.length > MAX_NOMBRE_DESTINATARIO) {
      throw new BadRequestException(`El nombre del destinatario ${i + 1} no puede pasar de ${MAX_NOMBRE_DESTINATARIO} caracteres`);
    }
    const telefono = normalizarTelefonoDestinatario(d.telefono);
    if (telefonos.has(telefono)) {
      throw new BadRequestException(`El teléfono de ${nombre} está repetido`);
    }
    telefonos.add(telefono);
    let id = typeof d.id === 'string' && UUID.test(d.id) ? d.id.toLowerCase() : randomUUID();
    if (ids.has(id)) id = randomUUID();
    ids.add(id);
    return { id, nombre, telefono };
  });
  return { destinatarios };
}
