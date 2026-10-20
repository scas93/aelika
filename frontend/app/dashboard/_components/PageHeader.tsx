"use client";

import { createContext, ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { IconDots, IconPlus } from "@tabler/icons-react";
import { useEsMovil } from "@/lib/use-es-movil";
import { ALL_NAV_ITEMS, buscarPorHref } from "../nav-items";
import Button from "./Button";
import BotonExportar from "./BotonExportar";
import MenuAcciones from "./MenuAcciones";

// Encabezado de página DENTRO del área de contenido (ya no hay franja blanca con borde): título a la izquierda, más chico, y las
// acciones generales de la página a la derecha en la misma fila. Las páginas declaran sus acciones con <PageActions acciones=…>,
// que las pinta en este espacio sin que cada página tenga que dibujar su propio título. Debajo van los controles propios de cada
// página (selector de día o semana, buscador, filtros).
const SlotContext = createContext<{ slot: HTMLElement | null; setSlot: (el: HTMLElement | null) => void } | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return <SlotContext.Provider value={{ slot, setSlot }}>{children}</SlotContext.Provider>;
}

export function PageHeader() {
  const pathname = usePathname();
  const ctx = useContext(SlotContext);
  const current = buscarPorHref(ALL_NAV_ITEMS, pathname ?? "");
  const title = current?.label ?? "Aelika";

  return (
    <div className="mb-3 flex items-center justify-between gap-x-4">
      <h1 className="min-w-0 truncate text-xl font-bold text-admin-ink">{title}</h1>
      <div ref={ctx?.setSlot} className="ml-auto flex shrink-0 items-center justify-end gap-2" />
    </div>
  );
}

export interface AccionPagina {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  // crear: la acción de crear de la pantalla («Nuevo pedido»): botón con texto en computadora y «+» en el teléfono.
  // exportar: botón de solo ícono (cuadrado, con tooltip). normal: botón con ícono y texto (en el teléfono va al menú «⋯»).
  tipo?: "crear" | "normal" | "exportar";
  disabled?: boolean;
  cargando?: boolean;
}

function Acciones({ acciones }: { acciones: AccionPagina[] }) {
  const movil = useEsMovil();

  if (!movil) {
    return (
      <>
        {acciones.map((a) =>
          a.tipo === "exportar" ? (
            <BotonExportar
              key={a.key}
              label={a.label as "Exportar Excel" | "Exportar CSV"}
              onClick={a.onClick}
              disabled={a.disabled}
              cargando={a.cargando}
            />
          ) : a.tipo === "crear" ? (
            <Button key={a.key} variant="primary" onClick={a.onClick} disabled={a.disabled}>
              {a.label}
            </Button>
          ) : (
            <Button key={a.key} variant="secondary" className="inline-flex items-center gap-1.5" onClick={a.onClick} disabled={a.disabled || a.cargando}>
              {a.icon}
              {a.label}
            </Button>
          ),
        )}
      </>
    );
  }

  // Teléfono: solo íconos. «+» para crear y «⋯» con un menú para las demás.
  const crear = acciones.find((a) => a.tipo === "crear");
  const resto = acciones.filter((a) => a !== crear);
  return (
    <>
      {resto.length > 0 && (
        <MenuAcciones
          label="Más acciones"
          icono={<IconDots size={20} />}
          acciones={resto.map((a) => ({ label: a.label, icon: a.icon, onClick: a.onClick, disabled: a.disabled || a.cargando }))}
        />
      )}
      {crear && (
        <button
          type="button"
          onClick={crear.onClick}
          disabled={crear.disabled}
          aria-label={crear.label}
          title={crear.label}
          className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-admin-control)] bg-admin-accent text-white transition hover:bg-admin-accent-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconPlus size={20} />
        </button>
      )}
    </>
  );
}

/** Acciones generales de la página, a la derecha del título. Fuera del layout del panel (p. ej. en pruebas) se pintan en su sitio. */
export function PageActions({ acciones }: { acciones: AccionPagina[] }) {
  const ctx = useContext(SlotContext);
  if (!ctx) return <Acciones acciones={acciones} />;
  return ctx.slot ? createPortal(<Acciones acciones={acciones} />, ctx.slot) : null;
}
