import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

let sesion: { token: string; user: { id: string; rol: string } };
vi.mock("@/lib/session-context", () => ({ useSession: () => sesion }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/lib/use-es-movil", () => ({ useEsMovil: () => false }));
const fetchUsers = vi.fn();
const createUser = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchUsers, createUser, updateUser };
});
const { default: Equipo } = await import("./page");
const { ApiError } = await import("@/lib/api");

afterEach(() => {
  cleanup();
  fetchUsers.mockReset();
  createUser.mockReset();
  updateUser.mockReset();
});

const equipo = [
  { id: "a", nombre: "Alma Admin", email: "alma@x.com", rol: "DUENO", activo: true, createdAt: "" },
  { id: "g", nombre: "Gus Gerente", email: "gus@x.com", rol: "GERENTE", activo: true, createdAt: "" },
  { id: "o", nombre: "Omar Operador", email: "omar@x.com", rol: "OPERADOR", activo: true, createdAt: "" },
  { id: "i", nombre: "Ines Inactiva", email: "ines@x.com", rol: "OPERADOR", activo: false, createdAt: "" },
];

const menuDe = (nombre: string) => screen.queryByRole("button", { name: `Acciones de ${nombre}` });
const fila = (nombre: string) => screen.getByText(nombre).closest("li") as HTMLElement;

async function abrir(rol: string, id: string) {
  sesion = { token: "t", user: { id, rol } };
  fetchUsers.mockResolvedValue(equipo);
  render(<Equipo />);
  await screen.findByText("Alma Admin");
}

describe("Ajustes → Equipo", () => {
  it("lista de solo lectura: cuenta, rol con etiqueta central, Inactivo solo en inactivos, sin selectores", async () => {
    await abrir("DUENO", "a");
    expect(screen.getByText("4 personas")).toBeTruthy();
    expect(within(fila("Alma Admin")).getByText("Admin")).toBeTruthy();
    expect(within(fila("Ines Inactiva")).getByText("Inactivo")).toBeTruthy();
    expect(screen.getAllByText("Inactivo")).toHaveLength(1);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent?.slice(0, 5))).toHaveLength(4);
    // Orden: Admin, Gerente, Operador, inactivos al final.
    const nombres = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(nombres[0]).toContain("Alma Admin");
    expect(nombres[3]).toContain("Ines Inactiva");
  });

  it("Admin: fila propia con «Tú» y sin menú; menú en las demás", async () => {
    await abrir("DUENO", "a");
    expect(within(fila("Alma Admin")).getByText("Tú")).toBeTruthy();
    expect(menuDe("Alma Admin")).toBeNull();
    expect(menuDe("Gus Gerente")).toBeTruthy();
    expect(menuDe("Omar Operador")).toBeTruthy();
  });

  it("Gerente: sin menú en su fila ni en la del Admin; con menú en Operadores", async () => {
    await abrir("GERENTE", "g");
    expect(menuDe("Gus Gerente")).toBeNull();
    expect(menuDe("Alma Admin")).toBeNull();
    expect(menuDe("Omar Operador")).toBeTruthy();
  });

  it("alta: el Gerente no ve Admin en el rol; el Admin sí", async () => {
    await abrir("GERENTE", "g");
    fireEvent.click(screen.getByRole("button", { name: "Agregar persona" }));
    let opciones = within(screen.getByRole("combobox")).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toStrictEqual(["Operador", "Gerente"]);
    cleanup();
    await abrir("DUENO", "a");
    fireEvent.click(screen.getByRole("button", { name: "Agregar persona" }));
    opciones = within(screen.getByRole("combobox")).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toStrictEqual(["Operador", "Gerente", "Admin"]);
  });

  it("alta: crea y muestra la contraseña temporal", async () => {
    await abrir("DUENO", "a");
    createUser.mockResolvedValue({ email: "n@x.com", temporaryPassword: "Temp-123" });
    fireEvent.click(screen.getByRole("button", { name: "Agregar persona" }));
    fireEvent.change(screen.getByPlaceholderText("Ana Torres"), { target: { value: "Nuevo" } });
    fireEvent.change(screen.getByPlaceholderText("ana@negocio.com"), { target: { value: "n@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(await screen.findByText("Temp-123")).toBeTruthy();
    expect(createUser).toHaveBeenCalledWith("t", { nombre: "Nuevo", email: "n@x.com", rol: "OPERADOR" });
  });

  it("cambiar rol: opciones sin el rol actual, y no llama a la API hasta confirmar", async () => {
    await abrir("DUENO", "a");
    fireEvent.click(menuDe("Omar Operador")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Cambiar rol" }));
    const opciones = within(screen.getByRole("combobox")).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toStrictEqual(["Gerente", "Admin"]);
    expect(updateUser).not.toHaveBeenCalled();
    updateUser.mockResolvedValue({});
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cambio" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith("t", "o", { rol: "GERENTE" }));
  });

  it("Gerente cambiando a un Operador: solo ofrece Gerente", async () => {
    await abrir("GERENTE", "g");
    fireEvent.click(menuDe("Omar Operador")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Cambiar rol" }));
    const opciones = within(screen.getByRole("combobox")).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toStrictEqual(["Gerente"]);
  });

  it("desactivar: pide confirmación con el nombre; cancelar no llama a la API", async () => {
    await abrir("DUENO", "a");
    fireEvent.click(menuDe("Omar Operador")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Desactivar" }));
    expect(screen.getByText("Omar Operador", { selector: "span.font-bold" })).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(updateUser).not.toHaveBeenCalled();
    fireEvent.click(menuDe("Omar Operador")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Desactivar" }));
    updateUser.mockResolvedValue({});
    fireEvent.click(screen.getAllByRole("button", { name: "Desactivar" }).at(-1)!);
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith("t", "o", { activo: false }));
  });

  it("un inactivo ofrece «Reactivar», también con confirmación", async () => {
    await abrir("DUENO", "a");
    fireEvent.click(menuDe("Ines Inactiva")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reactivar" }));
    expect(updateUser).not.toHaveBeenCalled();
    updateUser.mockResolvedValue({});
    fireEvent.click(screen.getAllByRole("button", { name: "Reactivar" }).at(-1)!);
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith("t", "i", { activo: true }));
  });

  it("el error del backend (409 último Admin) se muestra en el diálogo, que sigue abierto", async () => {
    await abrir("DUENO", "a");
    updateUser.mockRejectedValue(new ApiError("El negocio debe tener al menos un Admin activo", 409));
    fireEvent.click(menuDe("Gus Gerente")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Desactivar" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Desactivar" }).at(-1)!);
    expect(await screen.findByText("El negocio debe tener al menos un Admin activo")).toBeTruthy();
    expect(screen.getByText("Desactivar persona")).toBeTruthy();
  });

  it("un Operador no ve nada y no pide usuarios", () => {
    sesion = { token: "t", user: { id: "o", rol: "OPERADOR" } };
    render(<Equipo />);
    expect(screen.getByText(/no tiene acceso/)).toBeTruthy();
    expect(fetchUsers).not.toHaveBeenCalled();
  });
});
