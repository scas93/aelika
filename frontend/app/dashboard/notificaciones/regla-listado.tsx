"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  dispararReglaManual,
  fetchReglas,
  updateRegla,
  type Regla,
  type ReglaMensajeCategoria,
  type ResumenDisparoManual,
} from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Badge from "../_components/Badge";
import ToggleSwitch from "../_components/ToggleSwitch";
import Modal from "../_components/Modal";
import Table, { type TableColumn } from "../_components/Table";
import { TRIGGER_BADGE_COLOR, TRIGGER_LABEL } from "./labels";

interface ReglaListadoProps {
  categoria: ReglaMensajeCategoria;
  basePath: string;
  descripcion: string;
}

// Compartido por Recontacto (MARKETING) y Seguimiento (UTILITY) — ver esos
// dos page.tsx. Filtra client-side sobre el mismo GET /reglas de siempre
// (sin filtro de categoría en el backend, no hacía falta agregar uno para
// esto) — ya no hace falta la columna "Categoría" en la tabla, la separación
// la da en qué submódulo estás parado.
export default function ReglaListado({ categoria, basePath, descripcion }: ReglaListadoProps) {
  const { user, token } = useSession();

  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disparando, setDisparando] = useState<string | null>(null);
  const [resumenDisparo, setResumenDisparo] = useState<{ regla: Regla; resumen: ResumenDisparoManual } | null>(null);
  const [errorDisparo, setErrorDisparo] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchReglas(token);
      setReglas(data.filter((r) => r.plantillaCategoria === categoria));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las reglas");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria]);

  if (user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede administrar las reglas de notificación.</p>;
  }

  async function handleToggleActiva(regla: Regla) {
    setReglas((prev) => (prev ? prev.map((r) => (r.id === regla.id ? { ...r, activa: !regla.activa } : r)) : prev));
    await updateRegla(token, regla.id, { activa: !regla.activa });
  }

  async function handleDisparar(regla: Regla) {
    setDisparando(regla.id);
    setErrorDisparo(null);
    try {
      const resumen = await dispararReglaManual(token, regla.id);
      setResumenDisparo({ regla, resumen });
    } catch (err) {
      setErrorDisparo(err instanceof ApiError ? err.message : "No se pudo disparar la regla");
    } finally {
      setDisparando(null);
    }
  }

  // Columnas en el cuerpo del componente (no a nivel de módulo, a diferencia
  // de otras tablas migradas) porque capturan closures sobre estado/props de
  // esta instancia (basePath, handleToggleActiva, handleDisparar,
  // disparando) — "Estado" es un ToggleSwitch interactivo, no un Badge (no
  // hay ningún enum de estatus detrás, es el booleano `activa`), así que no
  // migra a variante semántica; "Trigger" sigue con el prop `color`
  // categórico de Badge (ya excluido de la migración a variantes).
  const columns: TableColumn<Regla>[] = [
    { key: "nombre", header: "Nombre", render: (regla) => <span className="font-bold">{regla.nombre}</span> },
    {
      key: "trigger",
      header: "Trigger",
      render: (regla) => <Badge color={TRIGGER_BADGE_COLOR[regla.trigger]}>{TRIGGER_LABEL[regla.trigger]}</Badge>,
    },
    {
      key: "estado",
      header: "Estado",
      render: (regla) => (
        <ToggleSwitch
          checked={regla.activa}
          onChange={() => handleToggleActiva(regla)}
          label={regla.activa ? "Desactivar" : "Activar"}
        />
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      render: (regla) => (
        <div className="flex justify-end gap-2">
          {regla.trigger === "MANUAL" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDisparar(regla)}
              disabled={disparando === regla.id || !regla.activa}
            >
              {disparando === regla.id ? "Disparando..." : "Disparar ahora"}
            </Button>
          )}
          <Link href={`${basePath}/${regla.id}`}>
            <Button variant="secondary" size="sm">
              Editar
            </Button>
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-admin-ink-soft">{descripcion}</p>
        <Link href={`${basePath}/nueva`}>
          <Button variant="primary">+ Nueva regla</Button>
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {errorDisparo && <p className="text-sm text-red-600">{errorDisparo}</p>}

      {reglas === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : reglas.length === 0 ? (
        <Card className="text-sm text-admin-ink-soft">
          Aún no tienes reglas — crea la primera con &quot;+ Nueva regla&quot;.
        </Card>
      ) : (
        <Table columns={columns} data={reglas} rowKey={(regla) => regla.id} />
      )}

      <Modal
        open={resumenDisparo !== null}
        onClose={() => setResumenDisparo(null)}
        title={`"${resumenDisparo?.regla.nombre ?? ""}" disparada`}
        footer={
          <Button variant="primary" onClick={() => setResumenDisparo(null)}>
            Cerrar
          </Button>
        }
      >
        {resumenDisparo && (
          <ul className="flex flex-col gap-1.5 text-sm text-admin-ink">
            <li>{resumenDisparo.resumen.clientesMatcheados} cliente(s) matcheados por el Filtro</li>
            <li>{resumenDisparo.resumen.enviosDisparados} envío(s) disparados</li>
            <li>{resumenDisparo.resumen.bloqueadosPorCandado} bloqueado(s) por el candado de frecuencia</li>
            {resumenDisparo.resumen.conError > 0 && (
              <li className="text-red-600">{resumenDisparo.resumen.conError} con error (revisa los logs del servidor)</li>
            )}
          </ul>
        )}
      </Modal>
    </div>
  );
}
