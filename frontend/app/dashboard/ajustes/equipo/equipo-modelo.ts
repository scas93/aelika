import type { Role, TeamUser } from "@/lib/api";

const ORDEN_ROL: Record<Role, number> = { DUENO: 0, GERENTE: 1, OPERADOR: 2 };

// Primero Admin, luego Gerente, luego Operador; dentro de cada grupo alfabético. Los inactivos van al final (con el mismo orden).
export function ordenarEquipo(users: TeamUser[]): TeamUser[] {
  return [...users].sort(
    (a, b) =>
      Number(!a.activo) - Number(!b.activo) ||
      ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol] ||
      a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }),
  );
}

// Roles que quien está en sesión puede asignar. El Gerente nunca ofrece Admin (el backend también lo rechaza con 403).
export function rolesAsignables(rolActual: Role): Role[] {
  return rolActual === "DUENO" ? ["OPERADOR", "GERENTE", "DUENO"] : ["OPERADOR", "GERENTE"];
}

// Si no se puede actuar sobre la fila, no hay menú: ni la propia fila, ni (para un Gerente) la de un Admin.
export function puedeActuarSobre(rolActual: Role, actorId: string, objetivo: TeamUser): boolean {
  if (objetivo.id === actorId) return false;
  if (rolActual !== "DUENO" && objetivo.rol === "DUENO") return false;
  return true;
}

// Opciones del diálogo «Cambiar rol»: las asignables, sin el rol que la persona ya tiene.
export function opcionesCambioRol(rolActual: Role, objetivo: TeamUser): Role[] {
  return rolesAsignables(rolActual).filter((r) => r !== objetivo.rol);
}
