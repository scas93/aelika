import type { Role } from "./api";

// El rol interno sigue siendo "DUENO" (API, base de datos, JWT); "Admin" es solo el nombre que ve el usuario.
export const ROLE_LABEL: Record<Role, string> = {
  OPERADOR: "Operador",
  GERENTE: "Gerente",
  DUENO: "Admin",
};
