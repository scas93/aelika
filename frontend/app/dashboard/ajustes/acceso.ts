import type { Role } from "@/lib/api";

// Quién entra a cada parte de Ajustes. El backend aplica lo mismo (la UI solo es la cara del gate): Información del negocio,
// Equipo y Días sin entrega (solo mayoreo) son de Admin y Gerente; todo lo demás, solo del Admin (rol interno DUENO). El
// Operador no tiene acceso a Ajustes.
export const SUBMODULOS_DE_GERENTE = [
  "/dashboard/ajustes/negocio",
  "/dashboard/ajustes/equipo",
  "/dashboard/ajustes/dias-sin-entrega",
];

export function puedeVerAjustes(rol: Role): boolean {
  return rol === "DUENO" || rol === "GERENTE";
}

export function puedeVerSubmodulo(rol: Role, href: string): boolean {
  if (rol === "DUENO") return true;
  return rol === "GERENTE" && SUBMODULOS_DE_GERENTE.includes(href);
}

/** Mensaje para quien llega por URL a una sección que no es suya (el contenido y sus llamadas a la API ni se montan). */
export function mensajeSinAcceso(rol: Role): string {
  return rol === "GERENTE"
    ? "Esta sección es exclusiva del Admin del negocio."
    : "Tu rol no tiene acceso a los ajustes del negocio.";
}
