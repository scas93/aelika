"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchClientesInscritosLealtad, type ClienteInscritoLealtad } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { formatFechaCorta, formatTelefono } from "@/lib/format";
import Card from "../_components/Card";
import Badge from "../_components/Badge";
import Table, { type TableColumn } from "../_components/Table";

const SELLOS_PARA_PREMIO = 10;

const COLUMNS: TableColumn<ClienteInscritoLealtad>[] = [
  { key: "nombre", header: "Nombre", render: (c) => <span className="font-bold">{c.nombre}</span> },
  { key: "telefono", header: "Teléfono", render: (c) => formatTelefono(c.telefono) },
  {
    key: "sellos",
    header: "Sellos",
    render: (c) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>
          {c.contador}/{SELLOS_PARA_PREMIO}
        </span>
        {c.estado === "PREMIO_DISPONIBLE" && <Badge variant="advertencia">Premio pendiente</Badge>}
      </span>
    ),
  },
  {
    key: "ultimoSello",
    header: "Último sello",
    render: (c) =>
      c.ultimoSelloAt ? formatFechaCorta(c.ultimoSelloAt) : <span className="text-admin-ink-soft">Sin sellos</span>,
  },
];

// Solo lectura. Se carga cada vez que se entra a la pestaña: lealtad/page.tsx
// desmonta la pestaña al cambiar, así que volver aquí después de registrar
// un sello siempre trae el estado actual (sin botón de refrescar). El orden
// ya viene resuelto por el backend.
export default function ClientesInscritosTab({ token }: { token: string }) {
  const { logout } = useSession();
  const [clientes, setClientes] = useState<ClienteInscritoLealtad[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    fetchClientesInscritosLealtad(token)
      .then((data) => {
        if (vigente) setClientes(data);
      })
      .catch((err) => {
        if (!vigente) return;
        // Sesión inválida/expirada — mismo trato que registrar-compra-tab.
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista de clientes inscritos");
      });
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- logout es estable por sesión; solo se recarga al montar
  }, [token]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!clientes) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }

  if (clientes.length === 0) {
    return (
      <Card className="text-sm text-admin-ink-soft">
        Aún no hay clientes inscritos — regístralos en la pestaña Registrar nuevo cliente.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm text-admin-ink-soft">
        {clientes.length} {clientes.length === 1 ? "cliente inscrito" : "clientes inscritos"}
      </span>
      <Table columns={COLUMNS} data={clientes} rowKey={(c) => c.id} />
    </div>
  );
}
