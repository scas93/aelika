// Formateo de fechas para el storefront de mayoreo — semanaDestino.inicio/fin
// vienen del backend como "YYYY-MM-DD" (fecha calendario, sin hora). Siempre
// se parsean/formatean en UTC aquí (nunca con la timezone local del
// navegador) para que "lunes 31" en pantalla sea exactamente el mismo lunes
// 31 que el backend valida al recibir el pedido — mismo cuidado que el bug
// de desfase de semanaInicio ya conocido en el dashboard (fase 4a).

function parseFechaUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function nombreDiaSemana(date: Date): string {
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", timeZone: "UTC" }).format(date);
}

function nombreMes(date: Date): string {
  return new Intl.DateTimeFormat("es-MX", { month: "long", timeZone: "UTC" }).format(date);
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** La fecha calendario de un día de la semana de pedido, a partir del lunes (offsetDias 0 = lunes ... 6 = domingo). */
export function fechaDelDiaSemana(inicioSemana: string, offsetDias: number): Date {
  const inicio = parseFechaUTC(inicioSemana);
  const fecha = new Date(inicio);
  fecha.setUTCDate(inicio.getUTCDate() + offsetDias);
  return fecha;
}

/** "Martes 15" — etiqueta de un día individual en la pantalla de distribución. */
export function etiquetaDiaConFecha(inicioSemana: string, offsetDias: number): string {
  const fecha = fechaDelDiaSemana(inicioSemana, offsetDias);
  return `${capitalizar(nombreDiaSemana(fecha))} ${fecha.getUTCDate()}`;
}

/** "lunes 14 al domingo 20 de enero" (o "...de agosto al ... de septiembre" si la semana cruza de mes). */
export function rangoSemanaTexto(inicio: string, fin: string): string {
  const dInicio = parseFechaUTC(inicio);
  const dFin = parseFechaUTC(fin);
  const diaInicio = nombreDiaSemana(dInicio);
  const diaFin = nombreDiaSemana(dFin);
  const mesInicio = nombreMes(dInicio);
  const mesFin = nombreMes(dFin);

  if (mesInicio === mesFin) {
    return `${diaInicio} ${dInicio.getUTCDate()} al ${diaFin} ${dFin.getUTCDate()} de ${mesInicio}`;
  }
  return `${diaInicio} ${dInicio.getUTCDate()} de ${mesInicio} al ${diaFin} ${dFin.getUTCDate()} de ${mesFin}`;
}
