"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconChevronDown, IconDots, IconFilter, IconPlus, IconSearch } from "@tabler/icons-react";
import Popover from "./Popover";
import BotonExportar from "./BotonExportar";
import Button from "./Button";
import MenuAcciones from "./MenuAcciones";

// UNA SOLA FILA de controles para todo el panel (nunca en dos líneas): selector de periodo o buscador, Filtros, acciones secundarias
// (exportar, Imprimir todo…) y crear. Si no cabe, se degrada por niveles: 1) etiqueta corta del selector, 2) botones solo con ícono,
// 3) acciones secundarias dentro de un «⋯» al final, 4) Filtros también dentro del «⋯». Siempre visibles: selector (o buscador) y crear.
// Una sola barra de búsqueda y filtros para todo el panel: buscador ancho con lupa que busca mientras escribes (sin botón
// «Buscar») y, si la pantalla tiene filtros, un botón «Filtros» que abre un panel con todos. Los filtros activos se ven como chips
// con su valor y ✕ debajo de la barra, con «Limpiar filtros». Cada filtro conserva su comportamiento: listas que aplican al elegir,
// Total con mínimo/máximo, fecha o semana con calendario desde/hasta.
export interface FiltroDef {
  key: string;
  label: string;
  // null = sin filtro aplicado
  valueLabel: string | null;
  onClear: () => void;
  // El contenido recibe `cerrar` (pliega su sección) para llamarlo después de aplicar.
  render: (p: { cerrar: () => void }) => ReactNode;
}

const ESPERA_MS = 300;
const NIVEL_MAX = 4;

export interface AccionBarra {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  cargando?: boolean;
  /** exportar: siempre solo ícono cuadrado; periodo: «Hoy»/«Esta semana» junto al selector; normal: ícono + texto (solo ícono si falta espacio). */
  tipo?: "exportar" | "normal" | "periodo";
}

export default function BarraBusqueda({
  placeholder,
  onBuscar,
  filtros = [],
  acciones = [],
  crear,
  izquierda,
}: {
  /** Sin placeholder/onBuscar la pantalla no tiene buscador (solo «Filtros»). */
  placeholder?: string;
  onBuscar?: (texto: string) => void;
  filtros?: FiltroDef[];
  /** Acciones secundarias (exportar, Imprimir todo, «Hoy»): lo primero que se esconde en el «⋯». */
  acciones?: AccionBarra[];
  /** Acción de crear («Nuevo pedido»): siempre visible; con poco espacio pasa a «+». */
  crear?: { label: string; onClick: () => void; disabled?: boolean };
  /** Contenido propio a la izquierda (selector de día o semana); recibe `corto` cuando falta espacio. */
  izquierda?: (p: { corto: boolean }) => ReactNode;
}) {
  const [texto, setTexto] = useState("");
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [seccion, setSeccion] = useState<string | null>(null);
  const primera = useRef(true);
  const filaRef = useRef<HTMLDivElement>(null);
  const envolturaRef = useRef<HTMLDivElement>(null);
  const [nivel, setNivel] = useState(0);
  const [ancho, setAncho] = useState(0);
  const ultimaClave = useRef("");

  // Busca mientras escribes, con una pequeña espera. La primera ejecución (montaje) no dispara nada.
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    const t = setTimeout(() => onBuscar?.(texto.trim()), ESPERA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const activos = filtros.filter((f) => f.valueLabel !== null);

  // Ancho disponible de la fila.
  useLayoutEffect(() => {
    const el = envolturaRef.current;
    if (!el) return;
    setAncho(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAncho(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ajuste por niveles: se empieza en el nivel 0 (todo con texto) y se sube un nivel mientras la fila se desborde. Si cambia el ancho
  // o el contenido, se vuelve a empezar desde 0 (así los botones recuperan su texto cuando hay espacio).
  const firma = [ancho, activos.length, filtros.length, acciones.map((a) => `${a.key}${a.label}`).join(","), crear?.label ?? "", texto === "" ? 0 : 1].join("|");
  useLayoutEffect(() => {
    if (ultimaClave.current !== firma) {
      ultimaClave.current = firma;
      if (nivel !== 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia el ajuste por niveles al cambiar ancho o contenido
        setNivel(0);
        return;
      }
    }
    const fila = filaRef.current;
    if (fila && fila.scrollWidth > fila.clientWidth + 1 && nivel < NIVEL_MAX) setNivel(nivel + 1);
  }, [firma, nivel]);

  const corto = nivel >= 1;
  const soloIcono = nivel >= 2;
  const secundariasEnMenu = nivel >= 3;
  const filtrosEnMenu = nivel >= 4 && filtros.length > 0;

  const periodo = acciones.find((a) => a.tipo === "periodo");
  const secundarias = acciones.filter((a) => a !== periodo);
  const enMenu = [...(secundariasEnMenu ? [...(periodo ? [periodo] : []), ...secundarias] : [])];
  const itemsMenu = [
    ...(filtrosEnMenu
      ? [{ label: activos.length > 0 ? `Filtros (${activos.length})` : "Filtros", icon: <IconFilter size={14} />, onClick: () => setPanelAbierto(true) }]
      : []),
    ...enMenu.map((a) => ({ label: a.label, icon: a.icon, onClick: a.onClick, disabled: a.disabled || a.cargando })),
  ];

  const panelFiltros = (
    <div className="-m-1 flex w-72 flex-col">
      {filtros.map((f) => {
        const abierta = seccion === f.key;
        return (
          <div key={f.key} className="border-b border-admin-border last:border-b-0">
            <button
              type="button"
              onClick={() => setSeccion(abierta ? null : f.key)}
              aria-expanded={abierta}
              className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm font-semibold text-admin-ink"
            >
              <span>{f.label}</span>
              <span className="flex min-w-0 items-center gap-1.5 font-normal text-admin-ink-soft">
                <span className="truncate">{f.valueLabel ?? ""}</span>
                <IconChevronDown size={14} className={`shrink-0 transition-transform ${abierta ? "rotate-180" : ""}`} />
              </span>
            </button>
            {abierta && <div className="px-1 pb-3">{f.render({ cerrar: () => setSeccion(null) })}</div>}
          </div>
        );
      })}
    </div>
  );
  const cerrarPanel = () => {
    setPanelAbierto(false);
    setSeccion(null);
  };

  const cuadrado = "inline-flex h-barra w-barra shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] border border-admin-border bg-white text-admin-ink transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div ref={envolturaRef} className="min-w-0">
        <div ref={filaRef} className="flex flex-nowrap items-center gap-2">
          {izquierda && <div className="shrink-0">{izquierda({ corto })}</div>}
          {periodo && !secundariasEnMenu && (
            <Button variant="secondary" size="barra" className="shrink-0" onClick={periodo.onClick} disabled={periodo.disabled}>
              {periodo.label}
            </Button>
          )}
          {onBuscar && (
            <div className="relative min-w-[7rem] flex-1">
              <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-admin-ink-soft" />
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder ?? "Buscar"}
                className="admin-input w-full bg-white! pl-9!"
              />
            </div>
          )}
          {!onBuscar && <div className="min-w-0 flex-1" />}

          {filtros.length > 0 && !filtrosEnMenu && (
            <Popover open={panelAbierto} onClose={cerrarPanel} trigger={
              <button
                type="button"
                onClick={() => setPanelAbierto((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={panelAbierto}
                aria-label="Filtros"
                title="Filtros"
                className={`inline-flex h-barra shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-admin-control)] border border-admin-border bg-white text-sm font-semibold text-admin-ink transition hover:bg-admin-bg ${soloIcono ? "w-barra" : "px-3"}`}
              >
                <IconFilter size={16} className="shrink-0" />
                {!soloIcono && "Filtros"}
                {activos.length > 0 && (
                  <span className="rounded-full bg-admin-accent px-1.5 text-xs font-bold leading-4 text-white">{activos.length}</span>
                )}
              </button>
            }>
              {panelFiltros}
            </Popover>
          )}
          {!secundariasEnMenu &&
            secundarias.map((a) =>
              a.tipo === "exportar" ? (
                <BotonExportar key={a.key} grande label={a.label as "Exportar Excel" | "Exportar CSV"} onClick={a.onClick} disabled={a.disabled} cargando={a.cargando} />
              ) : soloIcono ? (
                <button key={a.key} type="button" title={a.label} aria-label={a.label} onClick={a.onClick} disabled={a.disabled || a.cargando} className={cuadrado}>
                  {a.icon}
                </button>
              ) : (
                <Button key={a.key} variant="secondary" size="barra" className="shrink-0" onClick={a.onClick} disabled={a.disabled || a.cargando}>
                  {a.icon}
                  {a.label}
                </Button>
              ),
            )}
          {crear &&
            (soloIcono ? (
              <button
                type="button"
                title={crear.label}
                aria-label={crear.label}
                onClick={crear.onClick}
                disabled={crear.disabled}
                className="inline-flex h-barra w-barra shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] bg-admin-accent text-white transition hover:bg-admin-accent-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                <IconPlus size={20} />
              </button>
            ) : (
              <Button variant="primary" size="barra" className="shrink-0" onClick={crear.onClick} disabled={crear.disabled}>
                {crear.label}
              </Button>
            ))}
          {itemsMenu.length > 0 && (
            <>
              {filtrosEnMenu && (
                <Popover open={panelAbierto} onClose={cerrarPanel} trigger={<span className="block h-0 w-0" />}>
                  {panelFiltros}
                </Popover>
              )}
              <MenuAcciones label="Más acciones" tamano="barra" icono={<IconDots size={20} />} acciones={itemsMenu} />
            </>
          )}
        </div>
      </div>

      {activos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activos.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-admin-pill)] border border-admin-accent bg-admin-accent-soft py-1 pl-3 pr-2 text-sm font-semibold text-admin-accent-dark"
            >
              {f.label}: {f.valueLabel}
              <button
                type="button"
                onClick={f.onClear}
                aria-label={`Quitar filtro de ${f.label}`}
                className="leading-none text-admin-accent-dark/70 hover:text-admin-accent-dark"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => activos.forEach((f) => f.onClear())}
            className="text-sm font-semibold text-admin-accent hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}
