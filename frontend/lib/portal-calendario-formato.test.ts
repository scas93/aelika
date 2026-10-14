import { describe, expect, it } from "vitest";
import {
  enlaceContacto,
  etiquetaFecha,
  etiquetaFechaCorta,
  hora12,
  etiquetaMomento,
  mensajeContacto,
  rangoSemanaCorto,
  textoLimite,
  textoAgregaAntes,
  textoCambiaAntes,
  textoPideAntes,
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

describe("textoPideAntes y rangoSemanaCorto", () => {
  it("hora límite en 12 horas, hora de Ciudad de México", () => {
    // 2026-10-18 02:00Z = sáb 17 de oct, 20:00 en CDMX (UTC−6)
    expect(textoPideAntes("2026-10-18T02:00:00.000Z")).toBe(
      "Pide antes del sáb 17, 8:00 pm",
    );
    expect(textoPideAntes("2026-10-17T14:00:00.000Z")).toBe(
      "Pide antes del sáb 17, 8:00 am",
    );
  });

  it("rango corto dentro del mes y cruzando de mes", () => {
    expect(rangoSemanaCorto("2026-10-19", "2026-10-25")).toBe("19–25 oct");
    expect(rangoSemanaCorto("2026-10-26", "2026-11-01")).toBe("26 oct – 1 nov");
  });
});

describe("etiquetaFechaCorta", () => {
  it("«Jue 15 oct», sin «de» y sin desfase de zona", () => {
    expect(etiquetaFechaCorta("2026-10-15")).toBe("Jue 15 oct");
    expect(etiquetaFechaCorta("2026-11-01")).toBe("Dom 1 nov");
  });
});

describe("hora12", () => {
  it("convierte HH:mm a 12 horas con am/pm", () => {
    expect(hora12("08:00")).toBe("8:00 am");
    expect(hora12("12:00")).toBe("12:00 pm");
    expect(hora12("00:15")).toBe("12:15 am");
    expect(hora12("18:30")).toBe("6:30 pm");
  });
});

describe("textoCambiaAntes y textoAgregaAntes", () => {
  it("mismo formato de 12 horas que «Pide antes»", () => {
    // 2026-10-14 20:00Z = mié 14, 2:00 pm en CDMX
    expect(textoCambiaAntes("2026-10-14T20:00:00.000Z")).toBe(
      "Cambia antes del mié 14, 2:00 pm",
    );
    expect(textoAgregaAntes("2026-10-16T02:00:00.000Z")).toBe(
      "Agrega antes del jue 15, 8:00 pm",
    );
  });
});
