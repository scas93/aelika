"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, fetchAdopcionClientes, type AdopcionClientes, type AdopcionOrigen } from "@/lib/api";
import { rangoSemanaTexto } from "@/lib/pedido-b2b-fechas";
import Badge from "../_components/Badge";
import Button from "../_components/Button";
import Card from "../_components/Card";
import SummaryCard, { SUMMARY_GRID } from "../_components/SummaryCard";
import Table, { type TableColumn } from "../_components/Table";
import {
  ESTADO_LABEL,
  ESTADO_VARIANT,
  ETAPA_LABEL,
  ETAPA_VARIANT,
  desplazarSemana,
  filtrarClientes,
  formatoFecha,
  formatoFechaHora,
  ordenarClientes,
  type ClaveOrden,
  type Orden,
} from "./modelo";

type Fila = AdopcionClientes["clientes"][number];

const CLAVES: { clave: ClaveOrden; label: string }[] = [
  { clave: "nombre", label: "Nombre" },
  { clave: "estado", label: "Estado en la semana" },
  { clave: "etapa", label: "Etapa" },
  { clave: "ultimoAcceso", label: "Último acceso" },
  { clave: "primerPedido", label: "Primer pedido" },
  { clave: "pedidos", label: "Pedidos (4 semanas)" },
];

export function textoOrigen(o: AdopcionOrigen): string {
  if (o.casos === 0) return "Sin dato";
  return `${o.porcentajePortal}% cliente · ${o.porcentajePanel}% equipo (${o.casos} ${o.casos === 1 ? "pedido" : "pedidos"})`;
}

export default function ClientesTab({ token }: { token: string }) {
  // Sin semana = la próxima (lo decide el servidor, en hora de Ciudad de México).
  const [semana, setSemana] = useState<string | undefined>(undefined);
  const [resultado, setResultado] = useState<{ clave: string; data?: AdopcionClientes; error?: string } | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<Orden | null>(null);

  const clave = semana ?? "default";
  useEffect(() => {
    let activo = true;
    fetchAdopcionClientes(token, semana)
      .then((data) => activo && setResultado({ clave, data }))
      .catch((err) =>
        activo && setResultado({ clave, error: err instanceof ApiError ? err.message : "No se pudo cargar Adopción" }),
      );
    return () => {
      activo = false;
    };
  }, [token, semana, clave]);

  const data = resultado?.clave === clave ? resultado.data : undefined;
  const filas = useMemo(
    () => (data ? ordenarClientes(filtrarClientes(data.clientes, busqueda), orden) : []),
    [data, busqueda, orden],
  );

  if (resultado?.clave === clave && resultado.error) return <p className="text-sm text-red-600">{resultado.error}</p>;
  if (!data) return <p className="text-sm text-admin-ink-soft">Cargando...</p>;

  const { semana: sem, resumen, avisos } = data;
  const columnas: TableColumn<Fila>[] = [
    {
      key: "cliente",
      header: "Cliente",
      render: (f) => (
        <div className="flex flex-col gap-1">
          <span className="font-semibold">{f.nombre}</span>
          {f.codigo && <span className="text-xs text-admin-ink-soft">{f.codigo}</span>}
          {f.modificadoSinReconfirmar && <Badge variant="acento">Modificó, sin reconfirmar</Badge>}
        </div>
      ),
    },
    {
      key: "estado",
      header: "Esta semana",
      render: (f) => (
        <div className="flex flex-col items-start gap-1">
          <Badge variant={ESTADO_VARIANT[f.estado]}>{ESTADO_LABEL[f.estado]}</Badge>
          {f.pedidoId && (
            <Link className="text-xs text-admin-accent underline" href={`/dashboard/pedidos-b2b?pedido=${f.pedidoId}`}>
              {f.folio}
            </Link>
          )}
        </div>
      ),
    },
    { key: "etapa", header: "Etapa", render: (f) => <Badge variant={ETAPA_VARIANT[f.etapa]}>{ETAPA_LABEL[f.etapa]}</Badge> },
    {
      key: "acceso",
      header: "Último acceso",
      render: (f) =>
        f.ultimoAccesoAt ? formatoFechaHora(f.ultimoAccesoAt) : <span className="text-admin-ink-soft">Sin registro</span>,
    },
    {
      key: "primero",
      header: "Primer pedido",
      render: (f) => (f.primerPedidoAt ? formatoFecha(f.primerPedidoAt) : <span className="text-admin-ink-soft">—</span>),
    },
    { key: "pedidos", header: "Pedidos (4 sem.)", align: "right", render: (f) => f.pedidosUltimas4Semanas },
    { key: "origen", header: "Origen", render: (f) => <span className="text-xs">{textoOrigen(f.origen)}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setSemana(desplazarSemana(sem.inicio, -1))} aria-label="Semana anterior">
          ←
        </Button>
        <span className="min-w-[14rem] text-center text-sm font-semibold capitalize">{rangoSemanaTexto(sem.inicio, sem.fin)}</span>
        <Button variant="secondary" size="sm" onClick={() => setSemana(desplazarSemana(sem.inicio, 1))} aria-label="Semana siguiente">
          →
        </Button>
        <Button variant={sem.esActual ? "primary" : "secondary"} size="sm" onClick={() => setSemana(sem.enCurso)}>
          Esta semana
        </Button>
        <Button variant={sem.esProxima ? "primary" : "secondary"} size="sm" onClick={() => setSemana(undefined)}>
          Próxima
        </Button>
      </div>

      <div className={SUMMARY_GRID}>
        <SummaryCard label="Clientes que pidieron" value={resumen.pidieron} error={null} />
        <SummaryCard label="Pedidos sin confirmar" value={resumen.sinConfirmar} error={null} />
        <SummaryCard label="Habituales que no han pedido" value={resumen.habitualesSinPedir} error={null} />
        <SummaryCard label="Cancelaron" value={resumen.cancelaron} error={null} />
      </div>
      <p className="text-xs text-admin-ink-soft">
        Habitual = pidió en al menos 2 de las 4 semanas anteriores. «Pide con regularidad» = pidió en al menos 3. Los clientes dados
        de baja no se cuentan, salvo que tengan pedido en la semana. El último acceso solo existe desde que se empezó a registrar:
        «Sin registro» no significa que nunca haya entrado.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          type="search"
          placeholder="Buscar por nombre"
          aria-label="Buscar por nombre"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select
          className="input max-w-[14rem]"
          aria-label="Ordenar por"
          value={orden?.clave ?? ""}
          onChange={(e) => setOrden(e.target.value ? { clave: e.target.value as ClaveOrden, dir: orden?.dir ?? "asc" } : null)}
        >
          <option value="">Orden: habituales primero</option>
          {CLAVES.map((c) => (
            <option key={c.clave} value={c.clave}>
              {c.label}
            </option>
          ))}
        </select>
        {orden && (
          <Button variant="secondary" size="sm" onClick={() => setOrden({ ...orden, dir: orden.dir === "asc" ? "desc" : "asc" })}>
            {orden.dir === "asc" ? "Ascendente" : "Descendente"}
          </Button>
        )}
      </div>

      {filas.length === 0 ? (
        <Card>
          <p className="text-sm text-admin-ink-soft">{data.clientes.length === 0 ? "Aún no hay datos." : "Ningún cliente coincide con la búsqueda."}</p>
        </Card>
      ) : (
        <Table columns={columnas} data={filas} rowKey={(f) => f.id} />
      )}

      <Card className="flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-admin-ink-soft">Cancelados después de confirmar (esta semana)</span>
        <p className="text-xs text-admin-ink-soft">
          Solo pedidos con fecha de confirmación
          {avisos.confirmadoAtDesde ? `, que se registra desde el ${formatoFecha(avisos.confirmadoAtDesde)}` : " (todavía no se registra en este entorno)"}
          . Los pedidos anteriores no aparecen aquí.
        </p>
        {data.canceladosDespuesDeConfirmar.length === 0 ? (
          <p className="text-sm text-admin-ink-soft">Aún no hay datos.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {data.canceladosDespuesDeConfirmar.map((c) => (
              <li key={c.pedidoId} className="flex flex-wrap items-center gap-2">
                <Link className="text-admin-accent underline" href={`/dashboard/pedidos-b2b/historico?pedido=${c.pedidoId}`}>
                  {c.folio}
                </Link>
                <span className="font-semibold">{c.cliente}</span>
                <span className="text-admin-ink-soft">
                  confirmado {formatoFechaHora(c.confirmadoAt)}
                  {c.canceladoAt ? ` · cancelado ${formatoFechaHora(c.canceladoAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-admin-ink-soft">Origen de los pedidos (total)</span>
        <p className="text-sm">{data.origen.casos === 0 ? "Aún no hay datos." : textoOrigen(data.origen)}</p>
        <p className="text-xs text-admin-ink-soft">
          Solo cuenta pedidos creados desde que se registra el origen; los anteriores no se cuentan ni se asumen.
        </p>
      </Card>
    </div>
  );
}
