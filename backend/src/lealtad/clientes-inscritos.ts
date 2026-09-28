import { LoyaltyCardEstado } from '../../generated/prisma/enums';

/**
 * Una fila del listado de clientes inscritos (GET /lealtad/clientes). Solo
 * lo que la tabla necesita: NUNCA LoyaltyCard.token (es la credencial del
 * QR — quien lo tenga puede registrar sellos) ni serialNumber/clienteId.
 * `id` es LoyaltyCard.id, solo como key estable de la fila.
 */
export interface ClienteInscrito {
  id: string;
  nombre: string;
  telefono: string;
  contador: number;
  estado: LoyaltyCardEstado;
  // null = la tarjeta no tiene ningún sello todavía.
  ultimoSelloAt: Date | null;
  inscritoAt: Date;
}

const colator = new Intl.Collator('es', { sensitivity: 'base' });

/**
 * Orden determinista del listado:
 *   1. Premio pendiente primero (entre ellos, último sello más reciente).
 *   2. El resto con sellos, por último sello del más reciente al más antiguo.
 *   3. Al final los que no tienen sellos, por inscripción más reciente.
 *   4. Desempate: nombre alfabético (colación es, sin distinguir acentos ni
 *      mayúsculas) y, si aun así empatan, id — para que dos llamadas
 *      seguidas nunca regresen el mismo conjunto en otro orden.
 * Vive en TS (no en el ORDER BY) porque el orden alfabético en español
 * depende de la colación de la base, que no es la misma en todos los
 * entornos.
 */
export function compararInscritos(a: ClienteInscrito, b: ClienteInscrito): number {
  const premioA = a.estado === LoyaltyCardEstado.PREMIO_DISPONIBLE ? 0 : 1;
  const premioB = b.estado === LoyaltyCardEstado.PREMIO_DISPONIBLE ? 0 : 1;
  if (premioA !== premioB) return premioA - premioB;

  const sinSellosA = a.ultimoSelloAt ? 0 : 1;
  const sinSellosB = b.ultimoSelloAt ? 0 : 1;
  if (sinSellosA !== sinSellosB) return sinSellosA - sinSellosB;

  // A estas alturas ambos tienen sellos o ninguno tiene.
  const porFecha =
    a.ultimoSelloAt && b.ultimoSelloAt
      ? b.ultimoSelloAt.getTime() - a.ultimoSelloAt.getTime()
      : b.inscritoAt.getTime() - a.inscritoAt.getTime();
  if (porFecha !== 0) return porFecha;

  const porNombre = colator.compare(a.nombre, b.nombre);
  if (porNombre !== 0) return porNombre;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function ordenarInscritos(filas: ClienteInscrito[]): ClienteInscrito[] {
  return [...filas].sort(compararInscritos);
}
