import { describe, expect, it } from "vitest";
import {
  enlaceContacto,
  etiquetaFecha,
  etiquetaMomento,
  mensajeContacto,
  textoLimite,
} from "./portal-calendario-formato";
import type { DiaCalendarioPortal } from "./portal-api";

const dia = (extra: Partial<DiaCalendarioPortal>): DiaCalendarioPortal => ({
  fecha: "2026-10-02",
  diaSemana: "VIERNES",
  entregaAt: "2026-10-02T14:00:00.000Z",
  estado: "AGREGABLE",
  motivo: null,
  limiteAt: "2026-10-01T02:00:00.000Z",
  accion: "CREAR_PEDIDO",
  entrega: null,
  ...extra,
});

describe("portal-calendario-formato", () => {
  it("la fecha: solo la primera letra del día en mayúscula, el resto en minúsculas", () => {
    expect(etiquetaFecha("2026-10-12")).toBe("Lun 12 de oct");
    expect(etiquetaFecha("2026-10-04")).toBe("Dom 4 de oct");
    expect(etiquetaFecha("2026-12-01")).toBe("Mar 1 de dic");
  });

  it("la fecha no se corre por zona horaria", () => {
    expect(etiquetaFecha("2026-10-05")).toMatch(/5/);
    expect(etiquetaFecha("2026-10-05").toLowerCase()).toMatch(/lun/);
  });

  it("el momento se muestra en hora de Ciudad de México (UTC-6)", () => {
    // 2026-10-01T02:00Z = miércoles 30 sep 20:00 CDMX
    const t = etiquetaMomento("2026-10-01T02:00:00.000Z");
    expect(t).toMatch(/20:00/);
    expect(t).toMatch(/30/);
  });

  it("texto de la hora límite: disponible/modificable 'Hasta', cerrado 'Cerró', sin límite null", () => {
    expect(textoLimite(dia({}))).toMatch(/^Hasta /);
    expect(textoLimite(dia({ estado: "MODIFICABLE" }))).toMatch(/^Hasta /);
    expect(
      textoLimite(
        dia({ estado: "NO_DISPONIBLE", motivo: "ANTICIPACION_AGREGAR" }),
      ),
    ).toMatch(/^Cerró /);
    expect(
      textoLimite(
        dia({ estado: "CERRADO", motivo: "PEDIDO_PAGADO", limiteAt: null }),
      ),
    ).toBeNull();
  });

  it("enlace de contacto: solo con número de 10 dígitos; sin número no hay botón", () => {
    expect(enlaceContacto(null)).toBeNull();
    expect(enlaceContacto("123")).toBeNull();
    expect(enlaceContacto("3331006915")).toBe("https://wa.me/523331006915");
    expect(enlaceContacto("3331006915", "Hola P-000001")).toBe(
      "https://wa.me/523331006915?text=Hola%20P-000001",
    );
  });

  it("mensaje precargado según el contexto, con el nombre del cliente de la sesión", () => {
    expect(
      mensajeContacto({
        tipo: "dia",
        cliente: "Cafe Entredos",
        fecha: "2026-10-19",
      }),
    ).toBe(
      "Hola, soy Cafe Entredos. Quiero cambiar mi entrega del lunes 19 de octubre.",
    );
    expect(
      mensajeContacto({
        tipo: "pedido",
        cliente: "Cafe Entredos",
        folios: ["P-000004"],
      }),
    ).toBe("Hola, soy Cafe Entredos, sobre mi pedido P-000004.");
    expect(
      mensajeContacto({
        tipo: "pedido",
        cliente: "Cafe Entredos",
        folios: ["P-000004", "P-000005"],
      }),
    ).toBe("Hola, soy Cafe Entredos, sobre mi pedido P-000004 y P-000005.");
    expect(mensajeContacto({ tipo: "general", cliente: "Cafe Entredos" })).toBe(
      "Hola, soy Cafe Entredos, necesito ayuda con mi pedido.",
    );
  });
});
