import { describe, expect, it } from "vitest";
import {
  aplicarFavorito,
  construirEntregas,
  diasCerrados,
  fechasElegibles,
  favoritoDesdeSeleccion,
  repartirParejo,
  todoDistribuido,
  totalesPorSemana,
} from "./portal-pedido-modelo";
import type {
  CalendarioPortal,
  DiaCalendarioPortal,
  SemanaCalendarioPortal,
} from "./portal-api";

const DIAS = [
  "LUNES",
  "MARTES",
  "MIERCOLES",
  "JUEVES",
  "VIERNES",
  "SABADO",
  "DOMINGO",
];

function semana(
  inicio: string,
  opts: { pedido?: boolean; noDisponibles?: number[] } = {},
): SemanaCalendarioPortal {
  const base = new Date(`${inicio}T00:00:00Z`);
  const dias: DiaCalendarioPortal[] = DIAS.map((d, i) => {
    const f = new Date(base);
    f.setUTCDate(base.getUTCDate() + i);
    const fecha = f.toISOString().slice(0, 10);
    const cerrado = opts.noDisponibles?.includes(i);
    return {
      fecha,
      diaSemana: d,
      entregaAt: `${fecha}T14:00:00.000Z`,
      estado: cerrado ? "NO_DISPONIBLE" : "AGREGABLE",
      motivo: cerrado ? "ANTICIPACION_AGREGAR" : null,
      limiteAt: null,
      accion: cerrado
        ? null
        : opts.pedido
          ? "AGREGAR_A_PEDIDO"
          : "CREAR_PEDIDO",
      entrega: null,
    };
  });
  const fin = new Date(base);
  fin.setUTCDate(base.getUTCDate() + 6);
  return {
    semanaInicio: inicio,
    semanaFin: fin.toISOString().slice(0, 10),
    esActual: false,
    pedido: opts.pedido
      ? {
          folio: "P-000001",
          estado: "PENDIENTE_CONFIRMACION",
          pagado: false,
          activo: true,
        }
      : null,
    puedeCrear: !opts.pedido,
    dias,
  };
}

const calendario = (semanas: SemanaCalendarioPortal[]): CalendarioPortal => ({
  ahora: "2026-09-30T16:00:00.000Z",
  zonaHoraria: "America/Mexico_City",
  horaEntrega: "08:00",
  horasAgregar: 36,
  horasModificar: 18,
  horizonteSemanas: 1,
  numeroAtencion: null,
  cliente: { id: "c1", nombre: "Café" },
  pedidosActivos: 0,
  maximoActivos: 2,
  semanas,
});

describe("repartirParejo / todoDistribuido", () => {
  it("reparte enteros lo más parejo posible, el resto a las primeras fechas", () => {
    expect(repartirParejo(10, ["a", "b", "c"])).toEqual({ a: 4, b: 3, c: 3 });
    expect(repartirParejo(2, ["a", "b", "c"])).toEqual({ a: 1, b: 1, c: 0 });
    expect(repartirParejo(5, [])).toEqual({});
  });

  it("todoDistribuido exige que cada producto sume exactamente su total", () => {
    const f = ["2026-10-05", "2026-10-06"];
    expect(
      todoDistribuido(
        { p1: 10 },
        { p1: { "2026-10-05": 5, "2026-10-06": 5 } },
        f,
      ),
    ).toBe(true);
    expect(
      todoDistribuido(
        { p1: 10 },
        { p1: { "2026-10-05": 5, "2026-10-06": 4 } },
        f,
      ),
    ).toBe(false);
    expect(todoDistribuido({}, {}, f)).toBe(false);
  });
});

describe("construirEntregas y totales", () => {
  const entregas = construirEntregas(
    { p1: 12, p2: 4 },
    {
      p1: { "2026-10-02": 6, "2026-10-06": 6 },
      p2: { "2026-10-06": 4, "2026-10-02": 0 },
    },
    ["2026-10-06", "2026-10-02"],
  );

  it("una entrega por fecha, ordenadas, sin cantidades 0", () => {
    expect(entregas).toEqual([
      { fecha: "2026-10-02", items: [{ productId: "p1", cantidad: 6 }] },
      {
        fecha: "2026-10-06",
        items: [
          { productId: "p1", cantidad: 6 },
          { productId: "p2", cantidad: 4 },
        ],
      },
    ]);
  });

  it("totales por semana con el % del cliente sobre el total del pedido y mínimo por semana", () => {
    const cal = calendario([semana("2026-09-28"), semana("2026-10-05")]);
    const t = totalesPorSemana(
      entregas,
      cal.semanas,
      { p1: 50, p2: 30.5 },
      10,
      10,
    );
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({
      semanaInicio: "2026-09-28",
      piezas: 6,
      subtotal: 300,
      descuento: 30,
      total: 270,
      faltanPiezas: 4,
    });
    // 6 × 50 + 4 × 30.5 = 422; 10 % = 42.2
    expect(t[1]).toMatchObject({
      semanaInicio: "2026-10-05",
      piezas: 10,
      subtotal: 422,
      descuento: 42.2,
      total: 379.8,
      faltanPiezas: 0,
    });
  });

  it("sin descuento ni mínimo", () => {
    const cal = calendario([semana("2026-10-05")]);
    const t = totalesPorSemana(
      entregas.slice(1),
      cal.semanas,
      { p1: 50, p2: 30.5 },
      0,
      0,
    );
    expect(t[0]).toMatchObject({ descuento: 0, total: 422, faltanPiezas: 0 });
  });
});

describe("fechasElegibles", () => {
  it("solo días agregables de semanas sin pedido", () => {
    const cal = calendario([
      semana("2026-09-28", { pedido: true }),
      semana("2026-10-05", { noDisponibles: [0, 1] }),
    ]);
    expect(fechasElegibles(cal)).toEqual([
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });
});

describe("favorito", () => {
  const catalogo = [
    { id: "p1", nombre: "Café", descripcion: null, precio: 50, fotoUrl: null },
    {
      id: "p2",
      nombre: "Concha",
      descripcion: null,
      precio: 30.5,
      fotoUrl: null,
    },
  ];
  const favorito = {
    favorito: {
      guardadoAt: null,
      lineas: [
        { productId: "p1", nombre: "Café", dias: { LUNES: 6, MIERCOLES: 6 } },
        { productId: "p2", nombre: "Concha", dias: { VIERNES: 4 } },
        { productId: "p9", nombre: "Pan viejo", dias: { LUNES: 2 } },
      ],
    },
    noDisponibles: [],
  };

  it("se aplica a la primera semana sin pedido; quita días que ya no cumplen y productos ya no disponibles, con aviso", () => {
    // La semana en curso ya tiene pedido; la siguiente tiene el lunes cerrado.
    const cal = calendario([
      semana("2026-09-28", { pedido: true }),
      semana("2026-10-05", { noDisponibles: [0] }),
    ]);
    const r = aplicarFavorito(favorito, cal, catalogo)!;
    expect(r.fechas).toEqual(["2026-10-07", "2026-10-09"]);
    expect(r.carrito).toEqual({ p1: 6, p2: 4 });
    expect(r.dist).toEqual({
      p1: { "2026-10-07": 6 },
      p2: { "2026-10-09": 4 },
    });
    expect(r.avisos.join(" | ")).toMatch(/Pan viejo ya no está disponible/);
    expect(r.avisos.join(" | ")).toMatch(/lunes ya no cumple/);
  });

  it("sin favorito o sin semana disponible → null", () => {
    expect(
      aplicarFavorito(
        { favorito: null, noDisponibles: [] },
        calendario([semana("2026-10-05")]),
        catalogo,
      ),
    ).toBeNull();
    expect(
      aplicarFavorito(
        favorito,
        calendario([semana("2026-10-05", { pedido: true })]),
        catalogo,
      ),
    ).toBeNull();
  });

  it("guardar: plantilla por día de la semana de la PRIMERA semana elegida", () => {
    const cal = calendario([semana("2026-09-28"), semana("2026-10-05")]);
    const lineas = favoritoDesdeSeleccion(
      { p1: 12 },
      { p1: { "2026-10-02": 4, "2026-10-04": 2, "2026-10-06": 6 } },
      ["2026-10-02", "2026-10-04", "2026-10-06"],
      cal,
    );
    expect(lineas).toEqual([
      { productId: "p1", dias: { VIERNES: 4, DOMINGO: 2 } },
    ]);
  });
});

describe("diasCerrados", () => {
  it("solo los días que dejaron de cumplir el tiempo para pedir, en semanas sin pedido (los pasados no cuentan)", () => {
    const cal = calendario([
      semana("2026-09-28", { pedido: true, noDisponibles: [0] }),
      semana("2026-10-05", { noDisponibles: [0, 1] }),
    ]);
    // En la semana con pedido no se listan días; en la otra, lunes y martes (ANTICIPACION_AGREGAR).
    expect(diasCerrados(cal).map((d) => d.fecha)).toEqual([
      "2026-10-05",
      "2026-10-06",
    ]);
  });

  it("ninguno cuando todo es elegible", () => {
    expect(diasCerrados(calendario([semana("2026-10-05")]))).toEqual([]);
  });
});
