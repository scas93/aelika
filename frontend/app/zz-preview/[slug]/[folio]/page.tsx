"use client";
import { useEffect, useState, type ComponentType } from "react";

const prod = (productId: string, nombre: string, cantidad: number) => ({ productId, nombre, cantidad, precioUnitario: 30 });
const dia = (fecha: string, diaSemana: string, estado: string, motivo: string | null, productos: ReturnType<typeof prod>[] | null) => ({
  fecha, diaSemana, estado, motivo, limiteAt: "2026-10-16T20:00:00.000Z",
  entrega: productos ? { estado: "PENDIENTE", productos } : null,
});
const ESTADO = {
  folio: "P-000001", version: "v1", semanaInicio: "2026-10-12", semanaFin: "2026-10-18",
  estadoPedido: "CONFIRMADO_SURTIENDO", pagado: false, modificadoPorCliente: false, bloqueo: null,
  horasAgregar: 36, horasModificar: 18, descuentoPorcentaje: 0, minimoPiezas: 0, notaCliente: null, numeroAtencion: "5512345678",
  dias: [
    dia("2026-10-12", "LUNES", "CERRADO", "PASADO", [prod("A", "Concha", 12), prod("B", "Baguette", 6)]),
    dia("2026-10-13", "MARTES", "CERRADO", "PASADO", []),
    dia("2026-10-14", "MIERCOLES", "CERRADO", "ANTICIPACION_MODIFICAR", [prod("C", "Croissant", 20)]),
    dia("2026-10-15", "JUEVES", "MODIFICABLE", null, [prod("A", "Concha", 10)]),
    dia("2026-10-16", "VIERNES", "AGREGABLE", null, null),
  ],
};
const CAT = { cliente: { id: "c1", nombre: "Café Entredós" }, descuentoPorcentaje: 0, minimoPiezas: 0,
  categories: [
    { id: "x", nombre: "Pan dulce", products: ["A:Concha", "B:Baguette", "C:Croissant"].map((s) => ({ id: s[0], nombre: s.slice(2), precio: 30, descripcion: null, fotoUrl: null })) },
    { id: "y", nombre: "Pan salado", products: ["D:Telera", "E:Bolillo", "F:Ciabatta"].map((s) => ({ id: s[0], nombre: s.slice(2), precio: 12, descripcion: null, fotoUrl: null })) },
  ] };

export default function Preview() {
  const [Page, setPage] = useState<ComponentType | null>(null);
  useEffect(() => {
    const orig = window.fetch;
    window.fetch = async (input: RequestInfo | URL) => {
      const u = String(input);
      const body = u.includes("/modificar") ? ESTADO : u.includes("/catalogo") ? CAT
        : u.includes("/sesion") ? { negocio: { nombre: "Banetto" }, telefonoTerminacion: "6915", cliente: { id: "c1", nombre: "Café Entredós" }, clientes: [{ id: "c1", nombre: "Café Entredós" }], requiereSeleccion: false }
        : { numeroAtencion: "5512345678" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    import("@/app/mayoreo/[slug]/portal/pedidos/[folio]/modificar/page").then((m) => setPage(() => m.default));
    return () => { window.fetch = orig; };
  }, []);
  return Page ? <div className="mayoreo min-h-screen bg-mayoreo-bg"><Page /></div> : null;
}
