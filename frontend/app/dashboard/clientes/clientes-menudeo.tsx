"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchClientes, type Cliente, type PaginatedClientes } from "@/lib/api";
import { formatFechaSola, formatTelefono } from "@/lib/format";
import Card from "../_components/Card";
import Table, { type TableColumn } from "../_components/Table";
import BarraBusqueda from "../_components/BarraFiltros";

const LIMIT = 25;

const COLUMNS: TableColumn<Cliente>[] = [
  { key: "nombre", header: "Nombre", movil: true, render: (cliente) => <span className="font-bold">{cliente.nombre}</span> },
  { key: "telefono", header: "Teléfono", render: (cliente) => formatTelefono(cliente.telefono) },
  { key: "correo", header: "Correo", render: (cliente) => cliente.correo ?? "—" },
  { key: "pedidos", header: "Pedidos", align: "right", render: (cliente) => cliente.totalPedidos },
  { key: "ultimaCompra", header: "Última compra", movil: true, render: (cliente) => <span className="whitespace-nowrap">{formatFechaSola(cliente.ultimoPedidoAt)}</span> },
];

// Orden fijo: la última compra más reciente primero (sin control de «Ordenar por»).
export default function ClientesMenudeo() {
  const { user, token } = useSession();

  const [q, setQ] = useState("");
  const [result, setResult] = useState<PaginatedClientes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(
    async (page: number, texto: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchClientes(token, {
          q: texto.trim() || undefined,
          ordenarPor: "ultimoPedidoAt",
          orden: "desc",
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

  // Carga al abrir y cada vez que cambia la búsqueda (la barra espera un momento al teclear). Es un directorio: se muestra algo de
  // inmediato, y el caso «sin clientes todavía» resuelve a un estado vacío visible.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y recarga al cambiar la búsqueda
    cargar(1, q);
  }, [cargar, q]);

  if (user.rol !== "GERENTE" && user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">No tienes permiso para ver esta sección.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <BarraBusqueda placeholder="Buscar por nombre o teléfono…" onBuscar={setQ} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <>
          {result.data.length === 0 ? (
            <Card className="text-sm text-admin-ink-soft">
              {q.trim()
                ? "No hay clientes que coincidan con tu búsqueda."
                : "Aún no tienes clientes registrados — aparecerán aquí en cuanto reciban su primer pedido."}
            </Card>
          ) : (
            <Table
              columns={COLUMNS}
              data={result.data}
              rowKey={(cliente) => cliente.id}
              pagination={{
                page: result.page,
                totalPages: result.totalPages,
                total: result.total,
                limit: LIMIT,
                onPrevious: () => cargar(result.page - 1, q),
                onNext: () => cargar(result.page + 1, q),
                disabled: loading,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
