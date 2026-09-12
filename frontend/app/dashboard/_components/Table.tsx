import { ReactNode } from "react";
import Card from "./Card";
import Button from "./Button";

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
  render: (row: T) => ReactNode;
}

export interface TablePagination {
  page: number;
  totalPages: number;
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
  // Paginación opcional — se omite por completo (sin renderizar nada) en
  // los módulos que hoy no la tienen (ej. notificaciones/regla-listado).
  pagination?: TablePagination;
}

// No maneja el estado vacío ("sin resultados") — eso sigue siendo decisión
// de cada página (algunas lo envuelven en Card, otras no; hay un prompt
// aparte pendiente para unificarlo). Table solo se monta cuando ya hay
// datos que mostrar.
export default function Table<T>({ columns, data, rowKey, onRowClick, pagination }: TableProps<T>) {
  return (
    <>
      <Card padding={0} className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-admin-border text-admin-ink-soft">
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-3 font-bold ${col.align === "right" ? "text-right" : ""}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-admin-border last:border-b-0 ${
                  onRowClick ? "cursor-pointer hover:bg-admin-bg" : ""
                }`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-admin-ink ${col.align === "right" ? "text-right" : ""}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {pagination && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-admin-ink-soft">
            Página {pagination.page} de {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={pagination.onPrevious} disabled={!!pagination.disabled || pagination.page <= 1}>
              Anterior
            </Button>
            <Button
              variant="secondary"
              onClick={pagination.onNext}
              disabled={!!pagination.disabled || pagination.page >= pagination.totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
