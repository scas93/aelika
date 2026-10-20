"use client";

import { usePathname } from "next/navigation";
import { ALL_NAV_ITEMS, buscarPorHref } from "../nav-items";

// Encabezado de página DENTRO del área de contenido: solo el título. Todos los controles de la página (selector de periodo,
// buscador, Filtros, exportar, crear…) van en UNA fila debajo, la barra de controles (BarraBusqueda).
export function PageHeader() {
  const pathname = usePathname();
  const current = buscarPorHref(ALL_NAV_ITEMS, pathname ?? "");
  const title = current?.label ?? "Aelika";

  return (
    <div className="mb-3 flex items-center">
      <h1 className="min-w-0 truncate text-xl font-bold text-admin-ink">{title}</h1>
    </div>
  );
}
