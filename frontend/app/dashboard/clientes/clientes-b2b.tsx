"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchClientesB2b, type ClienteB2bEstadoFiltro, type ClienteB2bFila, type PaginatedClientesB2b } from "@/lib/api";
import { formatTelefono } from "@/lib/format";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Badge from "../_components/Badge";
import Table, { type TableColumn } from "../_components/Table";
import ClienteB2bAltaModal from "./cliente-b2b-form";
import ClienteB2bPanel from "./cliente-b2b-panel";

const LIMIT = 25;

const COLUMNS: TableColumn<ClienteB2bFila>[] = [
  { key: "codigo", header: "Código", render: (c) => <span className="text-admin-ink-soft">{c.codigo ?? "—"}</span> },
  {
    key: "nombre",
    header: "Nombre",
    render: (c) => (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{c.nombre}</span>
        {c.incompleto && <Badge variant="advertencia">Incompleto</Badge>}
        {!c.activo && <Badge variant="neutro">De baja</Badge>}
      </span>
    ),
  },
  { key: "telefono", header: "Teléfono principal", render: (c) => (c.telefonoPrincipal ? formatTelefono(c.telefonoPrincipal) : "—") },
  { key: "descuento", header: "Descuento", align: "right", render: (c) => (c.descuentoPorcentaje ? `${c.descuentoPorcentaje}%` : "—") },
  { key: "pedidos", header: "Pedidos activos", align: "right", render: (c) => c.pedidosActivos },
];

/** Módulo Clientes de un negocio de mayoreo (Gerente/Dueño): lista, alta, detalle/edición, teléfonos, baja y reactivación. */
export default function ClientesB2b() {
  const { token } = useSession();

  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<ClienteB2bEstadoFiltro>("ACTIVOS");
  const [result, setResult] = useState<PaginatedClientesB2b | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cargar = useCallback(
    async (page: number, filtros: { q: string; estado: ClienteB2bEstadoFiltro }) => {
      setLoading(true);
      setError(null);
      try {
        setResult(await fetchClientesB2b(token, { q: filtros.q.trim() || undefined, estado: filtros.estado, page, limit: LIMIT }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista de clientes");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial al montar
    cargar(1, { q: "", estado: "ACTIVOS" });
  }, [cargar]);

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Buscar
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && cargar(1, { q, estado })}
            placeholder="Nombre, código o teléfono..."
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Mostrar
          <select
            value={estado}
            onChange={(e) => {
              const nuevo = e.target.value as ClienteB2bEstadoFiltro;
              setEstado(nuevo);
              cargar(1, { q, estado: nuevo });
            }}
            className="admin-input"
          >
            <option value="ACTIVOS">Activos</option>
            <option value="BAJA">De baja</option>
            <option value="TODOS">Todos</option>
          </select>
        </label>
        <Button variant="secondary" onClick={() => cargar(1, { q, estado })} disabled={loading}>
          {loading ? "Buscando..." : "Buscar"}
        </Button>
        <Button variant="primary" onClick={() => setAltaAbierta(true)}>
          Nuevo cliente
        </Button>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <>
          <span className="text-sm text-admin-ink-soft">
            {result.total} cliente{result.total === 1 ? "" : "s"}
          </span>
          {result.data.length === 0 ? (
            <Card className="text-sm text-admin-ink-soft">
              {q.trim()
                ? "No hay clientes que coincidan con tu búsqueda."
                : estado === "BAJA"
                  ? "No hay clientes dados de baja."
                  : "Aún no hay clientes. Da de alta al primero con «Nuevo cliente»."}
            </Card>
          ) : (
            <Table
              columns={COLUMNS}
              data={result.data}
              rowKey={(c) => c.id}
              onRowClick={(c) => setSelectedId(c.id)}
              pagination={{
                page: result.page,
                totalPages: result.totalPages,
                onPrevious: () => cargar(result.page - 1, { q, estado }),
                onNext: () => cargar(result.page + 1, { q, estado }),
                disabled: loading,
              }}
            />
          )}
        </>
      )}

      <ClienteB2bAltaModal
        open={altaAbierta}
        onClose={() => setAltaAbierta(false)}
        onCreado={(c) => {
          setAltaAbierta(false);
          setSelectedId(c.id);
          cargar(1, { q, estado });
        }}
      />
      <ClienteB2bPanel clienteId={selectedId} onClose={() => setSelectedId(null)} onChanged={() => cargar(result?.page ?? 1, { q, estado })} />
    </div>
  );
}
