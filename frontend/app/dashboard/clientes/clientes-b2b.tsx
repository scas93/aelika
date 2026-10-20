"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchClientesB2b, type ClienteB2bEstadoFiltro, type ClienteB2bFila, type PaginatedClientesB2b } from "@/lib/api";
import { formatTelefono } from "@/lib/format";
import Card from "../_components/Card";
import Badge from "../_components/Badge";
import Table, { type TableColumn } from "../_components/Table";
import BarraBusqueda from "../_components/BarraFiltros";
import { FiltroSelectPopover } from "../_components/FiltroSelect";
import ClienteB2bAltaModal from "./cliente-b2b-form";
import ClienteB2bPanel from "./cliente-b2b-panel";

const LIMIT = 25;

const COLUMNS: TableColumn<ClienteB2bFila>[] = [
  {
    key: "nombre",
    header: "Nombre",
    movil: true,
    truncate: true,
    render: (c) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-bold">{c.nombre}</span>
        {c.incompleto && <span className="shrink-0"><Badge variant="advertencia">Incompleto</Badge></span>}
        {!c.activo && <span className="shrink-0"><Badge variant="neutro">De baja</Badge></span>}
      </span>
    ),
  },
  { key: "telefono", header: "Teléfono", compact: true, render: (c) => <span className="whitespace-nowrap">{c.telefonoPrincipal ? formatTelefono(c.telefonoPrincipal) : "—"}</span> },
  { key: "descuento", header: "Descuento", align: "right", compact: true, render: (c) => (c.descuentoPorcentaje ? `${c.descuentoPorcentaje}%` : "—") },
  { key: "pedidos", header: "Pedidos activos", align: "right", compact: true, movil: true, render: (c) => c.pedidosActivos },
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

  // Carga al abrir y cada vez que cambia la búsqueda o el filtro (la búsqueda ya espera un momento al teclear).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y recarga al cambiar búsqueda/filtro
    cargar(1, { q, estado });
  }, [cargar, q, estado]);

  // `?cliente=<id>` abre ese cliente directo («Ver cliente» desde el panel de un pedido). Se lee DESPUÉS de montar: en una
  // navegación del cliente (router.push) la URL aún no cambió durante el primer render.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("cliente");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lee la URL una sola vez al montar
    if (id) setSelectedId(id);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {/* Orden fijo: alfabético por nombre (un directorio de clientes dados de alta; no hay una fecha que ordenar). */}
      <BarraBusqueda
        placeholder="Buscar por nombre o teléfono…"
        onBuscar={setQ}
        crear={{ label: "Nuevo cliente", onClick: () => setAltaAbierta(true) }}
        filtros={[
          {
            key: "estado",
            label: "Estado",
            // «Activos» es lo normal: solo se muestra chip cuando se cambia.
            valueLabel: estado === "ACTIVOS" ? null : estado === "BAJA" ? "De baja" : "Todos",
            onClear: () => setEstado("ACTIVOS"),
            render: ({ cerrar }) => (
              <FiltroSelectPopover<ClienteB2bEstadoFiltro>
                opciones={[
                  { value: "ACTIVOS", label: "Activos" },
                  { value: "BAJA", label: "De baja" },
                  { value: "TODOS", label: "Todos" },
                ]}
                valorAplicado={estado}
                onAplicar={(v) => setEstado(v ?? "ACTIVOS")}
                close={cerrar}
              />
            ),
          },
        ]}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <>
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
                total: result.total,
                limit: LIMIT,
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
