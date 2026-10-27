import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { PublicProduct } from "@/lib/api";
import ProductModifiersModal from "./product-modifiers-modal";

const producto: PublicProduct = {
  id: "p1",
  nombre: "Latte",
  descripcion: null,
  precio: "50",
  fotoUrl: null,
  disponible: true,
  modifierGroups: [
    {
      id: "g1",
      nombre: "Tamaño",
      tipoSeleccion: "UNICA",
      obligatorio: false,
      opciones: [{ id: "o1", nombre: "Grande", precioAdicional: "10" }],
    },
  ],
} as unknown as PublicProduct;

function abrir() {
  const onConfirm = vi.fn();
  render(<ProductModifiersModal product={producto} precioUnitario={50} onClose={() => {}} onConfirm={onConfirm} />);
  return { onConfirm, campo: screen.getByPlaceholderText("Extra caliente, sin hielo…") as HTMLInputElement };
}

describe("Modal de producto: Instrucciones", () => {
  afterEach(cleanup);

  it("el campo está arriba de Cantidad y muestra un contador 0/140", () => {
    const { campo } = abrir();
    expect(screen.getByText("0/140")).toBeTruthy();
    const cantidad = screen.getByText("Cantidad");
    expect(campo.compareDocumentPosition(cantidad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin escribir nada confirma con nota vacía", () => {
    const { onConfirm } = abrir();
    fireEvent.click(screen.getByRole("button", { name: /^Agregar ·/ }));
    expect(onConfirm).toHaveBeenCalledWith([], 1, "");
  });

  it("confirma la nota normalizada (espacios repetidos y bordes)", () => {
    const { onConfirm, campo } = abrir();
    fireEvent.change(campo, { target: { value: "  Extra    caliente  " } });
    fireEvent.click(screen.getByRole("button", { name: /^Agregar ·/ }));
    expect(onConfirm).toHaveBeenCalledWith([], 1, "Extra caliente");
  });

  it("solo espacios = sin nota", () => {
    const { onConfirm, campo } = abrir();
    fireEvent.change(campo, { target: { value: "     " } });
    fireEvent.click(screen.getByRole("button", { name: /^Agregar ·/ }));
    expect(onConfirm).toHaveBeenCalledWith([], 1, "");
  });

  it("no deja pasar de 140 caracteres y el contador lo refleja", () => {
    const { campo } = abrir();
    fireEvent.change(campo, { target: { value: "a".repeat(200) } });
    expect(campo.value).toHaveLength(140);
    expect(screen.getByText("140/140")).toBeTruthy();
  });

  it("140 emojis caben (cuentan 1 cada uno, igual que en el backend)", () => {
    const { campo } = abrir();
    fireEvent.change(campo, { target: { value: "😀".repeat(140) } });
    expect([...campo.value]).toHaveLength(140);
    expect(screen.getByText("140/140")).toBeTruthy();
  });
});
