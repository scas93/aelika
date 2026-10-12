import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  CalendarioPortal,
  DiaCalendarioPortal,
  ResultadoPedidoPortal,
  SemanaCalendarioPortal,
} from "@/lib/portal-api";

// Ajustes de interfaz del portal (después de la 4d): scroll de la confirmación, botón de WhatsApp con mensaje por contexto
// y alerta flotante del favorito.

const fetchCalendario = vi.fn();
const fetchCatalogo = vi.fn();
const fetchFavorito = vi.fn();
vi.mock("@/lib/portal-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal-api")>();
  return {
    ...actual,
    fetchCalendario: (...a: unknown[]) => fetchCalendario(...a),
    fetchCatalogo: (...a: unknown[]) => fetchCatalogo(...a),
    fetchFavorito: (...a: unknown[]) => fetchFavorito(...a),
    cerrarSesion: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const { default: PasoConfirmacion } = await import("./crear/paso-confirmacion");
const { default: PasoDias } = await import("./crear/paso-dias");
const { default: AlertaFlotante } = await import("./alerta-flotante");
const { default: MenuPantalla } = await import("./menu-pantalla");
const { default: CrearPedido } = await import("./crear/crear-pedido");

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
  opts: { pedido?: boolean; noDisponibles?: number[]; pasados?: number[] } = {},
): SemanaCalendarioPortal {
  const base = new Date(`${inicio}T00:00:00Z`);
  const dias: DiaCalendarioPortal[] = DIAS.map((d, i) => {
    const f = new Date(base);
    f.setUTCDate(base.getUTCDate() + i);
    const fecha = f.toISOString().slice(0, 10);
    const pasado = opts.pasados?.includes(i);
    const cerrado = opts.noDisponibles?.includes(i);
    return {
      fecha,
      diaSemana: d,
      entregaAt: `${fecha}T14:00:00.000Z`,
      estado: pasado || cerrado ? "NO_DISPONIBLE" : "AGREGABLE",
      motivo: pasado ? "PASADO" : cerrado ? "ANTICIPACION_AGREGAR" : null,
      limiteAt: null,
      accion:
        pasado || cerrado
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

const calendario = (
  semanas: SemanaCalendarioPortal[],
  numeroAtencion: string | null = "3331006915",
): CalendarioPortal => ({
  ahora: "2026-10-01T16:00:00.000Z",
  zonaHoraria: "America/Mexico_City",
  horaEntrega: "08:00",
  horasAgregar: 36,
  horasModificar: 18,
  horizonteSemanas: 1,
  numeroAtencion,
  cliente: { id: "c1", nombre: "Cafe Entredos" },
  pedidosActivos: 0,
  maximoActivos: 2,
  semanas,
});

const resultado: ResultadoPedidoPortal = {
  pedidos: [
    {
      folio: "P-000004",
      semanaInicio: "2026-10-19",
      semanaFin: "2026-10-25",
      estado: "PENDIENTE_CONFIRMACION",
      totalPiezas: 10,
      subtotal: 650,
      descuentoPorcentaje: 0,
      descuentoTotal: 0,
      total: 650,
      entregas: [
        {
          fecha: "2026-10-19",
          productos: [
            {
              nombre: "Espiral",
              cantidad: 10,
              precioUnitario: 65,
              subtotal: 650,
            },
          ],
        },
      ],
    },
  ],
  total: 650,
};

/** Mensaje decodificado del enlace de WhatsApp. */
const mensajeDe = (a: HTMLElement) =>
  decodeURIComponent((a.getAttribute("href") ?? "").split("?text=")[1] ?? "");
const botones = () =>
  screen.queryAllByRole("link", { name: /Escribir por WhatsApp/ });

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  fetchCalendario.mockReset();
  fetchCatalogo.mockReset();
  fetchFavorito.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("confirmación del pedido", () => {
  it("al mostrarse sube al inicio de la página", () => {
    render(
      <PasoConfirmacion
        resultado={resultado}
        cliente="Cafe Entredos"
        numeroAtencion="3331006915"
        onVolver={() => {}}
      />,
    );
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("botón de WhatsApp con el mensaje del pedido (folio) y el nombre del cliente", () => {
    render(
      <PasoConfirmacion
        resultado={resultado}
        cliente="Cafe Entredos"
        numeroAtencion="3331006915"
        onVolver={() => {}}
      />,
    );
    const [boton] = botones();
    expect(boton).toBeInTheDocument();
    expect(boton.getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/523331006915\?text=/,
    );
    expect(mensajeDe(boton)).toBe(
      "Hola, soy Cafe Entredos, sobre mi pedido P-000004.",
    );
  });

  it("sin número de atención no hay botón", () => {
    render(
      <PasoConfirmacion
        resultado={resultado}
        cliente="Cafe Entredos"
        numeroAtencion={null}
        onVolver={() => {}}
      />,
    );
    expect(botones()).toHaveLength(0);
    expect(screen.queryByText(/Escribir por WhatsApp/)).toBeNull();
  });
});

describe("días: botón de WhatsApp", () => {
  const props = (cal: CalendarioPortal) => ({
    cliente: "Cafe Entredos",
    calendario: cal,
    fechas: [] as string[],
    favorito: null,
    onToggle: () => {},
    onUsarFavorito: () => {},
    onContinuar: () => {},
  });

  it("un solo día cerrado: el botón va junto a ese día con el mensaje del día", () => {
    // Lunes y martes pasados; miércoles dejó de cumplir el tiempo para pedir; el resto elegible.
    render(
      <PasoDias
        {...props(
          calendario([
            semana("2026-10-05", { pasados: [0, 1], noDisponibles: [2] }),
          ]),
        )}
      />,
    );
    const bs = botones();
    expect(bs).toHaveLength(1);
    expect(mensajeDe(bs[0])).toBe(
      "Hola, soy Cafe Entredos. Quiero cambiar mi entrega del miércoles 7 de octubre.",
    );
    // Está dentro del renglón de ese día, no en otro.
    expect(bs[0].closest("li")).toHaveTextContent(/mié/);
    // Los días que solo "ya pasaron" no llevan botón.
    expect(screen.getAllByText(/Ya pasó/).length).toBe(2);
  });

  it("varios días cerrados: un solo botón con el mensaje genérico", () => {
    render(
      <PasoDias
        {...props(
          calendario([semana("2026-10-05", { noDisponibles: [0, 1] })]),
        )}
      />,
    );
    const bs = botones();
    expect(bs).toHaveLength(1);
    expect(mensajeDe(bs[0])).toBe(
      "Hola, soy Cafe Entredos, necesito ayuda con mi pedido.",
    );
    // El botón general no está pegado a un día.
    expect(bs[0].closest("li")).toBeNull();
  });

  it("semana con pedido y un día cerrado en otra: un solo botón genérico", () => {
    render(
      <PasoDias
        {...props(
          calendario([
            semana("2026-09-28", { pedido: true }),
            semana("2026-10-05", { noDisponibles: [0] }),
          ]),
        )}
      />,
    );
    const bs = botones();
    expect(bs).toHaveLength(1);
    expect(mensajeDe(bs[0])).toBe(
      "Hola, soy Cafe Entredos, necesito ayuda con mi pedido.",
    );
  });

  it("sin número de atención no hay ningún botón, aunque haya días cerrados", () => {
    render(
      <PasoDias
        {...props(
          calendario([semana("2026-10-05", { noDisponibles: [0] })], null),
        )}
      />,
    );
    expect(botones()).toHaveLength(0);
  });

  it("sin días cerrados ni pedidos no hay botón", () => {
    render(<PasoDias {...props(calendario([semana("2026-10-05")]))} />);
    expect(botones()).toHaveLength(0);
  });

  it("cada día cerrado explica el motivo en una línea", () => {
    render(
      <PasoDias
        {...props(calendario([semana("2026-10-05", { noDisponibles: [0] })]))}
      />,
    );
    expect(
      screen.getByText(/Ya no hay tiempo para pedirlo/),
    ).toBeInTheDocument();
  });
});

describe("menú: botón de WhatsApp", () => {
  const sesion = {
    negocio: { nombre: "Banetto" },
    telefonoTerminacion: "6915",
    cliente: { id: "c1", nombre: "Cafe Entredos" },
    clientes: [{ id: "c1", nombre: "Cafe Entredos" }],
    requiereSeleccion: false,
  };

  it("con número de atención: mensaje genérico con el nombre del cliente", async () => {
    fetchCalendario.mockResolvedValue(calendario([semana("2026-10-05")]));
    render(
      <MenuPantalla
        slug="banetto"
        sesion={sesion}
        onCrear={() => {}}
        onVerPedidos={() => {}}
        onCambiarCliente={() => {}}
        onCerrada={() => {}}
      />,
    );
    const boton = await screen.findByRole("link", {
      name: /Escribir por WhatsApp/,
    });
    expect(mensajeDe(boton)).toBe(
      "Hola, soy Cafe Entredos, necesito ayuda con mi pedido.",
    );
  });

  it("Ver mis pedidos está habilitado y abre la lista; Modificar sigue deshabilitado", async () => {
    fetchCalendario.mockResolvedValue(calendario([semana("2026-10-05")]));
    const onVerPedidos = vi.fn();
    render(
      <MenuPantalla
        slug="banetto"
        sesion={sesion}
        onCrear={() => {}}
        onVerPedidos={onVerPedidos}
        onCambiarCliente={() => {}}
        onCerrada={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ver mis pedidos/ }));
    expect(onVerPedidos).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /Modificar pedido activo/ }),
    ).toBeDisabled();
    await waitFor(() => expect(fetchCalendario).toHaveBeenCalled());
  });

  it("sin número de atención: no hay botón", async () => {
    fetchCalendario.mockResolvedValue(calendario([semana("2026-10-05")], null));
    render(
      <MenuPantalla
        slug="banetto"
        sesion={sesion}
        onCrear={() => {}}
        onVerPedidos={() => {}}
        onCambiarCliente={() => {}}
        onCerrada={() => {}}
      />,
    );
    await waitFor(() => expect(fetchCalendario).toHaveBeenCalled());
    expect(botones()).toHaveLength(0);
  });
});

describe("alerta flotante", () => {
  it("aparece, no bloquea la pantalla y desaparece sola a los 3 segundos", () => {
    vi.useFakeTimers();
    const onCerrar = vi.fn();
    render(<AlertaFlotante mensaje="Aviso de prueba" onCerrar={onCerrar} />);
    const alerta = screen.getByRole("status");
    expect(alerta).toHaveTextContent("Aviso de prueba");
    expect(alerta.className).toMatch(/pointer-events-none/); // los toques pasan a lo de abajo
    expect(alerta.className).toMatch(/fixed/);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(onCerrar).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});

describe("crear pedido: favorito", () => {
  const sesion = {
    negocio: { nombre: "Banetto" },
    telefonoTerminacion: "6915",
    cliente: { id: "c1", nombre: "Cafe Entredos" },
    clientes: [{ id: "c1", nombre: "Cafe Entredos" }],
    requiereSeleccion: false,
  };
  const catalogo = {
    cliente: { id: "c1", nombre: "Cafe Entredos" },
    descuentoPorcentaje: 0,
    minimoPiezas: 0,
    categories: [
      {
        id: "k",
        nombre: "Pan",
        products: [
          {
            id: "p1",
            nombre: "Espiral",
            descripcion: null,
            precio: 65,
            fotoUrl: null,
          },
        ],
      },
    ],
  };
  const conFavorito = (dias: Record<string, number>) => ({
    favorito: {
      guardadoAt: null,
      lineas: [{ productId: "p1", nombre: "Espiral", dias }],
    },
    noDisponibles: [],
  });
  const montar = () =>
    render(
      <CrearPedido
        slug="banetto"
        sesion={sesion}
        onSalir={() => {}}
        onSesionTerminada={() => {}}
      />,
    );

  it("sin ninguna semana disponible para crear (ambas ya tienen pedido) no se ofrece «Usar mi favorito»", async () => {
    fetchCalendario.mockResolvedValue(
      calendario([
        semana("2026-09-28", { pedido: true }),
        semana("2026-10-05", { pedido: true }),
      ]),
    );
    fetchCatalogo.mockResolvedValue(catalogo);
    fetchFavorito.mockResolvedValue(conFavorito({ LUNES: 5 }));
    montar();
    await screen.findByText("Elige tus días de entrega");
    expect(
      screen.queryByRole("button", { name: "Usar mi favorito" }),
    ).toBeNull();
  });

  it("tampoco cuando las semanas sin pedido no tienen ningún día disponible", async () => {
    const cerrada = semana("2026-10-05", {
      noDisponibles: [0, 1, 2, 3, 4, 5, 6],
    });
    fetchCalendario.mockResolvedValue(
      calendario([semana("2026-09-28", { pedido: true }), cerrada]),
    );
    fetchCatalogo.mockResolvedValue(catalogo);
    fetchFavorito.mockResolvedValue(conFavorito({ LUNES: 5 }));
    montar();
    await screen.findByText("Elige tus días de entrega");
    expect(
      screen.queryByRole("button", { name: "Usar mi favorito" }),
    ).toBeNull();
  });

  it("con una semana disponible el botón sí aparece", async () => {
    fetchCalendario.mockResolvedValue(
      calendario([
        semana("2026-09-28", { pedido: true }),
        semana("2026-10-05"),
      ]),
    );
    fetchCatalogo.mockResolvedValue(catalogo);
    fetchFavorito.mockResolvedValue(conFavorito({ LUNES: 5 }));
    montar();
    expect(
      await screen.findByRole("button", { name: "Usar mi favorito" }),
    ).toBeInTheDocument();
  });

  it("si hay semana pero el favorito no cabe, muestra la alerta flotante con el mismo texto y se quita sola; la pantalla sigue usable", async () => {
    // Semana libre, pero el único día del favorito (lunes) ya no se puede pedir.
    fetchCalendario.mockResolvedValue(
      calendario([semana("2026-10-05", { noDisponibles: [0] })]),
    );
    fetchCatalogo.mockResolvedValue(catalogo);
    fetchFavorito.mockResolvedValue(conFavorito({ LUNES: 5 }));
    montar();

    fireEvent.click(
      await screen.findByRole("button", { name: "Usar mi favorito" }),
    );
    const alerta = await screen.findByRole("status");
    expect(alerta).toHaveTextContent(
      "Tu favorito no se pudo aplicar: ya no hay días disponibles para sus entregas. Elige los días a mano.",
    );
    // No se muestra además como banner dentro de la página.
    expect(screen.getAllByText(/Tu favorito no se pudo aplicar/)).toHaveLength(
      1,
    );
    // Los botones de la pantalla siguen ahí (la alerta no los tapa ni los bloquea).
    expect(
      screen.getByRole("button", { name: /Continuar/ }),
    ).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull(), {
      timeout: 4500,
    });
  }, 10000);
});
