"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchClientes, type ClienteOrdenarPor, type PaginatedClientes } from "@/lib/api";
import { formatFechaHora, formatTelefono } from "@/lib/format";
import Card from "../_components/Card";
import Button from "../_components/Button";

const LIMIT = 25;

// Un solo <select> con presets en vez de dos controles independientes
// (ordenarPor + orden) — para este listado solo hay 4 combinaciones útiles
// de negocio ("quién no compra hace tiempo" / "quién compra más seguido"),
// así que exponerlas como presets es más claro que dos dropdowns cruzados.
const ORDEN_OPCIONES: { value: string; label: string; ordenarPor: ClienteOrdenarPor; orden: "asc" | "desc" }[] = [
  { value: "ultimo-desc", label: "Última compra (más reciente)", ordenarPor: "ultimoPedidoAt", orden: "desc" },
  { value: "ultimo-asc", label: "Última compra (más antigua)", ordenarPor: "ultimoPedidoAt", orden: "asc" },
  { value: "total-desc", label: "Más pedidos", ordenarPor: "totalPedidos", orden: "desc" },
  { value: "total-asc", label: "Menos pedidos", ordenarPor: "totalPedidos", orden: "asc" },
];

export default function ClientesPage() {
  const { user, token } = useSession();

  const [q, setQ] = useState("");
  const [ordenValue, setOrdenValue] = useState(ORDEN_OPCIONES[0].value);
  const [result, setResult] = useState<PaginatedClientes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(
    async (page: number, filtros: { q: string; ordenValue: string }) => {
      setLoading(true);
      setError(null);
      try {
        const opcion = ORDEN_OPCIONES.find((o) => o.value === filtros.ordenValue) ?? ORDEN_OPCIONES[0];
        const res = await fetchClientes(token, {
          q: filtros.q.trim() || undefined,
          ordenarPor: opcion.ordenarPor,
          orden: opcion.orden,
          page,
          limit: LIMIT,
        });
        setResult(res);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista de clientes");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  // Carga inicial con los filtros default — a diferencia de
  // pedidos-b2b/historico (que espera a que se presione "Buscar"), aquí sí
  // se muestra algo de inmediato: es un directorio, no un reporte bajo
  // demanda, y el caso "tenant sin ningún cliente todavía" necesita
  // resolver a un estado vacío visible, no a una pantalla en blanco previa
  // a cualquier búsqueda.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    cargar(1, { q: "", ordenValue: ORDEN_OPCIONES[0].value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBuscar() {
    cargar(1, { q, ordenValue });
  }

  function handleOrdenChange(value: string) {
    setOrdenValue(value);
    cargar(1, { q, ordenValue: value });
  }

  if (user.rol !== "GERENTE" && user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">No tienes permiso para ver esta sección.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 min-w-[220px] flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Buscar
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
            placeholder="Nombre o teléfono..."
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Ordenar por
          <select value={ordenValue} onChange={(e) => handleOrdenChange(e.target.value)} className="admin-input">
            {ORDEN_OPCIONES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" onClick={handleBuscar} disabled={loading}>
          {loading ? "Buscando..." : "Buscar"}
        </Button>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <>
          <span className="text-sm text-admin-ink-soft">{result.total} clientes</span>

          {result.data.length === 0 ? (
            <Card className="text-sm text-admin-ink-soft">
              {q.trim()
                ? "No hay clientes que coincidan con tu búsqueda."
                : "Aún no tienes clientes registrados — aparecerán aquí en cuanto reciban su primer pedido."}
            </Card>
          ) : (
            <>
              <Card padding={0} className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-admin-border text-admin-ink-soft">
                      <th className="px-4 py-3 font-bold">Nombre</th>
                      <th className="px-4 py-3 font-bold">Teléfono</th>
                      <th className="px-4 py-3 font-bold">Correo</th>
                      <th className="px-4 py-3 text-right font-bold">Pedidos</th>
                      <th className="px-4 py-3 font-bold">Última compra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((cliente) => (
                      <tr key={cliente.id} className="border-b border-admin-border last:border-b-0">
                        <td className="px-4 py-3 font-bold text-admin-ink">{cliente.nombre}</td>
                        <td className="px-4 py-3 text-admin-ink">{formatTelefono(cliente.telefono)}</td>
                        <td className="px-4 py-3 text-admin-ink">{cliente.correo ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-admin-ink">{cliente.totalPedidos}</td>
                        <td className="px-4 py-3 text-admin-ink">{formatFechaHora(cliente.ultimoPedidoAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <div className="flex items-center justify-between">
                <span className="text-sm text-admin-ink-soft">
                  Página {result.page} de {result.totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => cargar(result.page - 1, { q, ordenValue })}
                    disabled={loading || result.page <= 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => cargar(result.page + 1, { q, ordenValue })}
                    disabled={loading || result.page >= result.totalPages}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
