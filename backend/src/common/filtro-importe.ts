// Comparador de importe compartido por los 3 endpoints de listado que
// filtran un campo Decimal (Order.total, PedidoB2b.total, Payment.amount —
// ver ListOrdersHistoricoQueryDto/ListPedidosB2bQueryDto/ListPaymentsQueryDto).
// No es el mismo dominio que ReglaFiltroOperador (schema.prisma) — ese vive
// en Prisma ligado a Regla.filtro (campo/operador/valor sobre Cliente);
// este es un query param HTTP sobre un monto, sin relación con Reglas. Mismo
// estilo (mayúsculas con guion bajo, siempre inclusivo) a propósito, más
// ENTRE (rango), que ReglaFiltroOperador no tiene — extensión deliberada
// para este caso, no una coincidencia de no revisar el otro enum.
export enum FiltroImporteOperador {
  MAYOR_IGUAL = 'MAYOR_IGUAL',
  MENOR_IGUAL = 'MENOR_IGUAL',
  IGUAL = 'IGUAL',
  ENTRE = 'ENTRE',
}

interface FiltroImporteWhere {
  gte?: number;
  lte?: number;
  equals?: number;
}

// Construye el fragmento de `where` de Prisma para un campo Decimal — mismo
// switch reusado por los 3 services en vez de reimplementarlo cada uno.
// `valor`/`valorHasta` se asumen ya validados por el DTO (ver
// FiltroImporteOperador arriba): `valor` siempre presente si `operador` lo
// está, `valorHasta` siempre presente si `operador = ENTRE`.
export function filtroImporteWhere(
  operador: FiltroImporteOperador | undefined,
  valor: number | undefined,
  valorHasta: number | undefined,
): FiltroImporteWhere | undefined {
  if (!operador) return undefined;

  switch (operador) {
    case FiltroImporteOperador.IGUAL:
      return { equals: valor };
    case FiltroImporteOperador.MAYOR_IGUAL:
      return { gte: valor };
    case FiltroImporteOperador.MENOR_IGUAL:
      return { lte: valor };
    case FiltroImporteOperador.ENTRE:
      return { gte: valor, lte: valorHasta };
  }
}
