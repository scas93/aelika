import { describe, expect, it } from "vitest";
import {
  construirEntregas,
  diaSemanaDeFecha,
  favoritoDelDia,
  lineasDeFavoritoDia,
  losDia,
  mismasCantidades,
  nombreDiaSemana,
  usarFavoritoDia,
  copiarDia,
  diasCerrados,
  diasVacios,
  piezasDia,
  ponerCantidad,
  sinDiasQuitados,
  totalesPorSemana,
} from "./portal-pedido-modelo";
import type {
  CalendarioPortal,
  FavoritoPortal,
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

describe("captura por día", () => {
  const porDia = {
    "2026-10-06": { p1: 6, p2: 4 },
    "2026-10-02": { p1: 6, p2: 0 },
    "2026-10-08": {},
  };
  const fechas = ["2026-10-06", "2026-10-02", "2026-10-08"];

  it("piezasDia suma solo cantidades > 0", () => {
    expect(piezasDia({ p1: 6, p2: 4 })).toBe(10);
    expect(piezasDia({ p1: 0 })).toBe(0);
    expect(piezasDia(undefined)).toBe(0);
  });

  it("ponerCantidad crea, cambia y con 0 quita la línea, sin tocar otros días", () => {
    let d = ponerCantidad({}, "2026-10-02", "p1", 3);
    expect(d).toEqual({ "2026-10-02": { p1: 3 } });
    d = ponerCantidad(d, "2026-10-06", "p1", 5);
    d = ponerCantidad(d, "2026-10-02", "p1", 0);
    expect(d).toEqual({ "2026-10-02": {}, "2026-10-06": { p1: 5 } });
  });

  it("diasVacios lista, en orden, los días elegidos sin productos", () => {
    expect(diasVacios(porDia, fechas)).toEqual(["2026-10-08"]);
    expect(diasVacios({}, ["2026-10-06", "2026-10-02"])).toEqual([
      "2026-10-02",
      "2026-10-06",
    ]);
  });

  it("copiarDia reemplaza el destino con las cantidades del origen (una copia, no la misma referencia)", () => {
    const r = copiarDia(
      { "2026-10-05": { p1: 4, p2: 0, p3: 2 }, "2026-10-06": {} },
      "2026-10-05",
      "2026-10-06",
    );
    expect(r["2026-10-06"]).toEqual({ p1: 4, p3: 2 });
    r["2026-10-06"].p1 = 99;
    expect(r["2026-10-05"].p1).toBe(4);
  });

  it("sinDiasQuitados conserva los días que siguen elegidos", () => {
    expect(sinDiasQuitados(porDia, ["2026-10-06", "2026-10-08"])).toEqual({
      "2026-10-06": { p1: 6, p2: 4 },
      "2026-10-08": {},
    });
  });
});

describe("construirEntregas y totales", () => {
  const entregas = construirEntregas(
    {
      "2026-10-02": { p1: 6 },
      "2026-10-06": { p1: 6, p2: 4, p3: 0 },
      "2026-10-08": {},
    },
    ["2026-10-06", "2026-10-02", "2026-10-08"],
  );

  it("una entrega por fecha, ordenadas, sin cantidades 0 y sin días vacíos (forma exacta del POST)", () => {
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
      productos: [{ productId: "p1", cantidad: 6 }],
    });
    // 6 × 50 + 4 × 30.5 = 422; 10 % = 42.2
    expect(t[1]).toMatchObject({
      semanaInicio: "2026-10-05",
      piezas: 10,
      subtotal: 422,
      descuento: 42.2,
      total: 379.8,
      faltanPiezas: 0,
      // Total de la semana por producto (suma de todos sus días).
      productos: [
        { productId: "p1", cantidad: 6 },
        { productId: "p2", cantidad: 4 },
      ],
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

describe("favorito por día de la semana", () => {
  const catalogo = [
    { id: "p1", nombre: "Café", descripcion: null, precio: 50, fotoUrl: null },
    {
      id: "p2",
      nombre: "Concha",
      descripcion: null,
      precio: 20,
      fotoUrl: null,
    },
  ];
  const fav = (
    lineas: {
      productId: string;
      nombre: string;
      dias: Record<string, number>;
    }[],
    noDisponibles: string[] = [],
  ): FavoritoPortal => ({
    favorito: { guardadoAt: null, lineas },
    noDisponibles,
  });
  const base = fav([
    { productId: "p1", nombre: "Café", dias: { LUNES: 6, MIERCOLES: 2 } },
    { productId: "p2", nombre: "Concha", dias: { LUNES: 3 } },
  ]);

  it("diaSemanaDeFecha y los nombres en español", () => {
    expect(diaSemanaDeFecha("2026-10-05")).toBe("LUNES");
    expect(diaSemanaDeFecha("2026-10-07")).toBe("MIERCOLES");
    expect(diaSemanaDeFecha("2026-10-11")).toBe("DOMINGO");
    expect(nombreDiaSemana("MIERCOLES")).toBe("miércoles");
    expect(losDia("LUNES")).toBe("los lunes");
    expect(losDia("MIERCOLES")).toBe("los miércoles");
    expect(losDia("SABADO")).toBe("los sábados");
    expect(losDia("DOMINGO")).toBe("los domingos");
  });

  it("favoritoDelDia: solo las cantidades de ese día de la semana; vacío sin favorito", () => {
    expect(favoritoDelDia(base, "LUNES")).toEqual({ p1: 6, p2: 3 });
    expect(favoritoDelDia(base, "MIERCOLES")).toEqual({ p1: 2 });
    expect(favoritoDelDia(base, "MARTES")).toEqual({});
    expect(favoritoDelDia(null, "LUNES")).toEqual({});
    expect(
      favoritoDelDia({ favorito: null, noDisponibles: [] }, "LUNES"),
    ).toEqual({});
  });

  it("mismasCantidades ignora las de cantidad 0 y distingue productos y cantidades", () => {
    expect(mismasCantidades({ p1: 6, p2: 3 }, { p2: 3, p1: 6 })).toBe(true);
    expect(mismasCantidades({ p1: 6, p2: 0 }, { p1: 6 })).toBe(true);
    expect(mismasCantidades({ p1: 6 }, { p1: 5 })).toBe(false);
    expect(mismasCantidades({ p1: 6 }, { p1: 6, p2: 1 })).toBe(false);
    expect(mismasCantidades({}, undefined)).toBe(true);
  });

  it("usarFavoritoDia llena con las cantidades del día y avisa de los productos que ya no están", () => {
    const r = usarFavoritoDia(base, "LUNES", catalogo);
    expect(r.lineas).toEqual({ p1: 6, p2: 3 });
    expect(r.avisos).toEqual([]);
    // Producto fuera del catálogo vigente: se omite y se nombra.
    const sinConcha = usarFavoritoDia(base, "LUNES", catalogo.slice(0, 1));
    expect(sinConcha.lineas).toEqual({ p1: 6 });
    expect(sinConcha.avisos).toEqual(["Concha ya no está disponible"]);
    // Los que el servidor ya quitó (noDisponibles) también se avisan, sin duplicar.
    const conBaja = usarFavoritoDia(
      fav(
        [{ productId: "p1", nombre: "Café", dias: { LUNES: 6 } }],
        ["Espiral", "Espiral"],
      ),
      "LUNES",
      catalogo,
    );
    expect(conBaja.lineas).toEqual({ p1: 6 });
    expect(conBaja.avisos).toEqual(["Espiral ya no está disponible"]);
  });

  it("lineasDeFavoritoDia arma el cuerpo del PUT sin cantidades 0", () => {
    expect(lineasDeFavoritoDia({ p1: 6, p2: 0, p3: 2 })).toEqual([
      { productId: "p1", cantidad: 6 },
      { productId: "p3", cantidad: 2 },
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
