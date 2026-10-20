import { Fragment, ReactNode } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import Card from "./Card";

// Encabezado/alineación/paginación centralizados — antes copiados a mano en
// 5 módulos (pedidos/historico, notificaciones/regla-listado,
// pedidos-b2b/historico, clientes, pagos). El contenido de cada celda sigue
// siendo dueño de cada columna (`render`), incluyendo peso de fuente o
// widgets interactivos (ToggleSwitch, botones de acción) — Table solo pone
// la estructura de <table>/<thead>/<tbody> y el tratamiento de fila/paginación
// comunes, nunca decide qué se ve dentro de una celda.
export interface TableColumn<T> {
  key: string;
  header: string;
  align?: "right";
  // La columna absorbe el ancho sobrante y su contenido se recorta con «…» antes que provocar scroll horizontal (el render debe
  // devolver un elemento con `truncate`/`min-w-0`).
  truncate?: boolean;
  // La columna ocupa solo lo que necesita su contenido (sin salto de línea); pensada para convivir con una columna `truncate`.
  compact?: boolean;
  // En el teléfono (< 768 px) cada tabla muestra solo dos columnas: la principal y la más útil. Las columnas con `movil` se quedan; las
  // demás se ocultan (si ninguna lo marca, se muestran todas).
  movil?: boolean;
  render: (row: T) => ReactNode;
}

export interface TablePagination {
  page: number;
  totalPages: number;
  // Total de resultados y tamaño de página: el conteo va abajo, «1–20 de 46 resultados», junto a las flechas.
  total: number;
  limit: number;
  onPrevious: () => void;
  onNext: () => void;
  // Se suma (con OR) a los límites de page/totalPages — algunos módulos
  // (ej. pedidos-b2b/historico, clientes) también deshabilitan mientras hay
  // una búsqueda en curso; otros (pedidos/historico, pagos) no lo hacían y
  // se quedan sin pasar esto.
  disabled?: boolean;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  // Presente = la fila es clicable: agrega cursor-pointer + hover de fondo
  // y dispara esto al hacer click. Ausente = fila estática, sin hover ni
  // cursor — hoy solo pedidos-b2b/historico pasa esto.
  onRowClick?: (row: T) => void;
  // Fila desplegable: si devuelve contenido, se pinta bajo la fila en una celda que abarca todas las columnas (null = fila plegada).
  expandedRow?: (row: T) => ReactNode | null;
  // Paginación opcional — se omite por completo (sin renderizar nada) en
  // los módulos que hoy no la tienen (ej. notificaciones/regla-listado).
  pagination?: TablePagination;
}

// No maneja el estado vacío ("sin resultados") — eso sigue siendo decisión
// de cada página (algunas lo envuelven en Card, otras no; hay un prompt
// aparte pendiente para unificarlo). Table solo se monta cuando ya hay
// datos que mostrar.
export default function Table<T>({ columns, data, rowKey, onRowClick, expandedRow, pagination }: TableProps<T>) {
  const hayMovil = columns.some((c) => c.movil);
  const oculta = (c: TableColumn<T>) => (hayMovil && !c.movil ? "max-md:hidden" : "");
  return (
    <>
      <Card padding={0} className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-admin-border text-admin-ink-soft">
              {columns.map((col) => (
                <th key={col.key} className={`${oculta(col)} ${col.compact ? "w-px whitespace-nowrap px-3 max-md:px-2" : "px-4"} py-3 font-bold ${col.align === "right" ? "text-right" : ""}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const expansion = expandedRow?.(row) ?? null;
              return (
                <Fragment key={rowKey(row)}>
                  <tr
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`border-b border-admin-border last:border-b-0 ${onRowClick ? "cursor-pointer hover:bg-admin-bg" : ""} ${
                      expansion ? "border-b-0" : ""
                    }`}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${oculta(col)} ${col.compact ? "w-px whitespace-nowrap px-3 max-md:px-2" : "px-4"} py-3 text-admin-ink ${col.align === "right" ? "text-right" : ""} ${col.truncate ? "w-full max-w-0 overflow-hidden" : ""}`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                  {expansion && (
                    <tr className="border-b border-admin-border last:border-b-0">
                      <td colSpan={columns.length} className="bg-admin-bg/60 px-4 py-3">
                        {expansion}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      {pagination && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-admin-ink-soft">
            {pagination.total === 0
              ? "0 resultados"
              : `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} de ${pagination.total} ${pagination.total === 1 ? "resultado" : "resultados"}`}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={pagination.onPrevious}
              disabled={!!pagination.disabled || pagination.page <= 1}
              aria-label="Página anterior"
              className="inline-flex h-tabla w-tabla items-center justify-center rounded-[var(--radius-admin-control)] border border-admin-border bg-white text-admin-ink transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={pagination.onNext}
              disabled={!!pagination.disabled || pagination.page >= pagination.totalPages}
              aria-label="Página siguiente"
              className="inline-flex h-tabla w-tabla items-center justify-center rounded-[var(--radius-admin-control)] border border-admin-border bg-white text-admin-ink transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
