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
const crearPedido = vi.fn();
const guardarFavoritoDia = vi.fn();
vi.mock("@/lib/portal-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal-api")>();
  return {
    ...actual,
    fetchCalendario: (...a: unknown[]) => fetchCalendario(...a),
    fetchCatalogo: (...a: unknown[]) => fetchCatalogo(...a),
    fetchFavorito: (...a: unknown[]) => fetchFavorito(...a),
    crearPedido: (...a: unknown[]) => crearPedido(...a),
    guardarFavoritoDia: (...a: unknown[]) => guardarFavoritoDia(...a),
    cerrarSesion: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const { default: PasoConfirmacion } = await import("./crear/paso-confirmacion");
const { default: PasoDias } = await import("./crear/paso-dias");
const { default: PasoSemana } = await import("./crear/paso-semana");
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
    puedeCrear: !opts.pedido && dias.some((d) => d.estado === "AGREGABLE"),
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
  crearPedido.mockReset();
  guardarFavoritoDia.mockReset();
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
        horaEntrega="08:00"
        ubicacion={null}
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
        horaEntrega="08:00"
        ubicacion={null}
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
        horaEntrega="08:00"
        ubicacion={null}
        onVolver={() => {}}
      />,
    );
    expect(botones()).toHaveLength(0);
    expect(screen.queryByText(/Escribir por WhatsApp/)).toBeNull();
  });
});

describe("confirmación: cuándo y dónde recojo", () => {
  it("una fila por día con la hora de recolección y las piezas, dirección y línea de total/folio", () => {
    render(
      <PasoConfirmacion
        resultado={resultado}
        cliente="Cafe Entredos"
        numeroAtencion={null}
        horaEntrega="08:00"
        ubicacion="Justo Sierra 2117, Guadalajara"
        onVolver={() => {}}
      />,
    );
    expect(screen.getByText("Tus recolecciones")).toBeInTheDocument();
    expect(screen.getAllByText(/8:00 am/).length).toBeGreaterThan(0);
    expect(screen.getByText("Recoge en")).toBeInTheDocument();
    expect(
      screen.getByText("Justo Sierra 2117, Guadalajara"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Total $650.00 · Folio P-000004"),
    ).toBeInTheDocument();
    // Ya no repite productos ni desglose.
    expect(screen.queryByText("Espiral")).toBeNull();
  });

  it("sin dirección capturada no hay bloque «Recoge en»", () => {
    render(
      <PasoConfirmacion
        resultado={resultado}
        cliente="Cafe Entredos"
        numeroAtencion={null}
        horaEntrega="08:00"
        ubicacion="  "
        onVolver={() => {}}
      />,
    );
    expect(screen.queryByText("Recoge en")).toBeNull();
  });
});

describe("días: botón de WhatsApp", () => {
  // El paso de días muestra una sola semana: la primera sin pedido.
  const props = (cal: CalendarioPortal) => ({
    cliente: "Cafe Entredos",
    calendario: cal,
    semana: cal.semanas.find((x) => !x.pedido)!,
    fechas: [] as string[],
    onToggle: () => {},
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
    expect(bs[0].closest("li")).toHaveTextContent(/mié/i);
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

  it("solo muestra los días de la semana elegida", () => {
    const cal = calendario([semana("2026-10-05"), semana("2026-10-12")]);
    render(<PasoDias {...props(cal)} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
    expect(screen.getByText(/Semana 5/)).toBeInTheDocument();
    expect(screen.queryByText(/Semana 12/)).toBeNull();
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
      screen.getByText("Ya no hay tiempo para hacer pedido"),
    ).toBeInTheDocument();
  });
});

describe("días: filas de la lista", () => {
  it("los días disponibles llevan solo la fecha (sin «Pide antes del…»); los no elegibles conservan su motivo", () => {
    const cal = calendario([
      semana("2026-10-05", { pasados: [0], noDisponibles: [1] }),
    ]);
    render(
      <PasoDias
        cliente="Cafe Entredos"
        calendario={cal}
        semana={cal.semanas[0]}
        fechas={[]}
        onToggle={() => {}}
        onContinuar={() => {}}
      />,
    );
    expect(screen.queryByText(/Pide antes del/)).toBeNull();
    const filas = screen.getAllByRole("checkbox");
    // Disponible (miércoles): solo la fecha.
    // (el ✓ de la casilla es parte del texto, transparente cuando no está elegida).
    expect((filas[2].textContent ?? "").replace("✓", "")).toBe("Mié 7 de oct");
    // Ya pasó y sin tiempo para pedir: conservan su motivo.
    expect(filas[0]).toHaveTextContent(/Ya pasó/);
    expect(filas[1]).toHaveTextContent("Ya no hay tiempo para hacer pedido");
    // El encabezado se queda igual.
    expect(
      screen.getByText(/Pide con al menos\s+36\s+horas de anticipación/),
    ).toBeInTheDocument();
  });
});

describe("selector de semana", () => {
  const montarSemanas = (cal: CalendarioPortal, onElegir = vi.fn()) => {
    render(
      <PasoSemana
        cliente="Cafe Entredos"
        calendario={cal}
        onElegir={onElegir}
      />,
    );
    return onElegir;
  };

  it("una tarjeta por semana del horizonte, también con una sola semana", () => {
    montarSemanas(calendario([semana("2026-10-05")]));
    expect(screen.getByText(/Semana 5/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hacer pedido" }),
    ).toBeInTheDocument();
  });

  it("con pedido modificable: aviso y botón «Modificar pedido» hacia ese folio, sin «Hacer pedido» para esa semana", () => {
    montarSemanas(
      calendario([
        semana("2026-09-28", { pedido: true }),
        semana("2026-10-05"),
      ]),
    );
    expect(
      screen.getByText("Ya tienes un pedido para esta semana"),
    ).toBeInTheDocument();
    const enlace = screen.getByRole("link", { name: "Modificar pedido" });
    expect(enlace.getAttribute("href")).toMatch(
      /\/portal\/pedidos\/P-000001\/modificar\?desde=dias$/,
    );
    expect(
      screen.getAllByRole("button", { name: "Hacer pedido" }),
    ).toHaveLength(1);
  });

  it("con pedido no modificable (pagado): sin «Modificar», con acceso a ver el pedido", () => {
    const pagada = semana("2026-09-28", { pedido: true });
    pagada.pedido!.pagado = true;
    montarSemanas(calendario([pagada, semana("2026-10-05")]));
    expect(screen.queryByRole("link", { name: "Modificar pedido" })).toBeNull();
    expect(
      screen.getByText("Este pedido ya no se puede modificar"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ver pedido" }).getAttribute("href"),
    ).toMatch(/\/portal\/pedidos\/P-000001$/);
  });

  it("sin pedido y sin días disponibles: «Ya no se puede pedir para esta semana», sin botón", () => {
    montarSemanas(
      calendario([
        semana("2026-10-05", { noDisponibles: [0, 1, 2, 3, 4, 5, 6] }),
      ]),
    );
    expect(
      screen.getByText("Ya no se puede pedir para esta semana"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hacer pedido" })).toBeNull();
  });

  it("«Hacer pedido» elige esa semana", () => {
    const onElegir = montarSemanas(
      calendario([semana("2026-10-05"), semana("2026-10-12")]),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Hacer pedido" })[1]);
    expect(onElegir).toHaveBeenCalledWith(
      expect.objectContaining({ semanaInicio: "2026-10-12" }),
    );
  });

  it("con una semana con pedido y número de atención: un solo botón de WhatsApp genérico", () => {
    montarSemanas(
      calendario([
        semana("2026-09-28", { pedido: true }),
        semana("2026-10-05"),
      ]),
    );
    const bs = botones();
    expect(bs).toHaveLength(1);
    expect(mensajeDe(bs[0])).toBe(
      "Hola, soy Cafe Entredos, necesito ayuda con mi pedido.",
    );
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
        onModificar={() => {}}
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

  it("Ver mis pedidos y Modificar pedido activo están habilitados", async () => {
    fetchCalendario.mockResolvedValue(calendario([semana("2026-10-05")]));
    const onVerPedidos = vi.fn();
    render(
      <MenuPantalla
        slug="banetto"
        sesion={sesion}
        onCrear={() => {}}
        onVerPedidos={onVerPedidos}
        onModificar={() => {}}
        onCambiarCliente={() => {}}
        onCerrada={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ver mis pedidos/ }));
    expect(onVerPedidos).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /Modificar pedido activo/ }),
    ).toBeEnabled();
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
        onModificar={() => {}}
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

describe("crear pedido: captura por día", () => {
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
        id: "k1",
        nombre: "Pan",
        products: [
          {
            id: "p1",
            nombre: "Espiral",
            descripcion: null,
            precio: 65,
            fotoUrl: "https://x.test/espiral.jpg",
          },
          {
            id: "p2",
            nombre: "Concha",
            descripcion: null,
            precio: 20,
            fotoUrl: null,
          },
        ],
      },
      {
        id: "k2",
        nombre: "Bebidas",
        products: [
          {
            id: "p3",
            nombre: "Jugo",
            descripcion: null,
            precio: 30,
            fotoUrl: null,
          },
        ],
      },
    ],
  };
  let semanaAElegir = 0;
  beforeEach(() => {
    semanaAElegir = 0;
  });
  const favoritoDe = (
    lineas: [string, string, Record<string, number>][],
    noDisponibles: string[] = [],
  ) => ({
    favorito: {
      guardadoAt: "2026-10-01T00:00:00.000Z",
      lineas: lineas.map(([productId, nombre, dias]) => ({
        productId,
        nombre,
        dias,
      })),
    },
    noDisponibles,
  });
  const SIN_FAVORITO = { favorito: null, noDisponibles: [] };
  const montar = (
    semanas = [semana("2026-10-05")],
    favorito: unknown = SIN_FAVORITO,
  ) => {
    fetchCalendario.mockResolvedValue(calendario(semanas));
    fetchCatalogo.mockResolvedValue(catalogo);
    if (favorito instanceof Error) fetchFavorito.mockRejectedValue(favorito);
    else fetchFavorito.mockResolvedValue(favorito);
    return render(
      <CrearPedido
        slug="banetto"
        sesion={sesion}
        onSalir={() => {}}
        onSesionTerminada={() => {}}
      />,
    );
  };
  // Elige días por su etiqueta («Lun 5 oct») y entra al primer paso por día.
  async function elegirDias(...etiquetas: string[]) {
    await screen.findByText("Elige la semana de tu pedido");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Hacer pedido" })[semanaAElegir],
    );
    await screen.findByText("Elige tus días de entrega");
    for (const e of etiquetas)
      fireEvent.click(
        await screen.findByRole("checkbox", {
          name: new RegExp(e.replace(" oct", " de oct")),
        }),
      );
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    await screen.findByRole("tablist");
  }
  const mas = (nombre: string, dia: string, veces = 1) => {
    for (let i = 0; i < veces; i++)
      fireEvent.click(
        screen.getByRole("button", {
          name: `Una pieza más: ${nombre} el ${dia}`,
        }),
      );
  };
  const boton = (re: RegExp) => screen.getByRole("button", { name: re });

  it("el paso de días ya no ofrece «Usar mi favorito» y llega al paso por día sin pasos de total ni reparto", async () => {
    montar(
      [semana("2026-10-05")],
      favoritoDe([["p1", "Espiral", { LUNES: 5 }]]),
    );
    await screen.findByText("Elige la semana de tu pedido");
    expect(
      screen.queryByRole("button", { name: "Usar mi favorito" }),
    ).toBeNull();
    await elegirDias("Lun 5 oct");
    expect(
      screen.queryByRole("button", { name: "Usar mi favorito" }),
    ).toBeNull();
    expect(screen.getByText("¿Qué quieres cada día?")).toBeInTheDocument();
    expect(screen.queryByText("Elige tus productos")).toBeNull();
    expect(screen.queryByText(/Repartir/)).toBeNull();
  });

  it("muestra el catálogo completo por categoría, con chips, foto o marcador, sin buscador", async () => {
    montar();
    await elegirDias("Lun 5 oct");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "Pan" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Bebidas" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Categorías" });
    expect(nav).toHaveTextContent("Pan");
    expect(nav).toHaveTextContent("Bebidas");
    // Foto con producto que la tiene; el marcador neutro ocupa el mismo lugar si no.
    expect(
      document.querySelectorAll('li img[src="https://x.test/espiral.jpg"]'),
    ).toHaveLength(1);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(3);
  });

  it("un día vacío no deja avanzar: el botón está deshabilitado con «Agrega al menos un pan»", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct");
    expect(boton(/Siguiente: Mar 6/)).toBeDisabled();
    expect(screen.getByText("Agrega al menos un pan")).toBeInTheDocument();
    mas("Espiral", "Lun 5 oct");
    expect(boton(/Siguiente: Mar 6/)).toBeEnabled();
    expect(screen.queryByText("Agrega al menos un pan")).toBeNull();
    expect(screen.getByText(/Lun 5 · 1 pzs/)).toBeInTheDocument();
  });

  it("«vacío» siempre en naranja de aviso, también en la pestaña seleccionada (más claro sobre el fondo oscuro)", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct");
    const [activa, otra] = screen.getAllByRole("tab");
    expect(activa).toHaveAttribute("aria-selected", "true");
    const color = (tab: HTMLElement) =>
      screen.getAllByText("vacío").find((e) => tab.contains(e))!.className;
    expect(color(activa)).toContain("text-amber-300");
    expect(color(otra)).toContain("text-amber-700");
    // Con productos deja de ser naranja.
    mas("Espiral", "Lun 5 oct");
    expect(activa.textContent).toContain("1 pzs");
    expect(activa.innerHTML).not.toContain("text-amber");
  });

  it("pestañas: muestran piezas o «vacío» y se puede saltar entre días", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct");
    mas("Espiral", "Lun 5 oct", 3);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("Lun 53 pzs");
    expect(tabs[1]).toHaveTextContent("Mar 6vacío");
    fireEvent.click(tabs[1]);
    expect(screen.getByRole("tab", { name: /Mar 6/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Cada día guarda lo suyo.
    expect(
      screen.getByRole("spinbutton", { name: "Espiral el Mar 6 oct" }),
    ).toHaveValue(null);
  });

  it("copiar: aparece en los días que no son el primero, vacíos, y siempre copia del PRIMER día; un toque llena y la barra desaparece", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct", "Mié 7 oct");
    // El primer día no tiene barra, aunque esté vacío o con productos.
    expect(screen.queryByRole("button", { name: /^Igual que / })).toBeNull();
    mas("Espiral", "Lun 5 oct", 4);
    mas("Concha", "Lun 5 oct", 2);
    expect(screen.queryByRole("button", { name: /^Igual que / })).toBeNull();
    fireEvent.click(boton(/Siguiente: Mar 6/));
    expect(
      screen.getByRole("button", { name: "Igual que lun 5" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Igual que / }));
    expect(screen.getByText(/Mar 6 · 6 pzs/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Igual que / })).toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "Espiral el Mar 6 oct" }),
    ).toHaveValue(4);
    // Ajustar el martes no cambia la base: el miércoles también propone el lunes.
    mas("Espiral", "Mar 6 oct", 3);
    fireEvent.click(boton(/Siguiente: Mié 7/));
    expect(
      screen.getByRole("button", { name: "Igual que lun 5" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Igual que / }));
    expect(
      screen.getByRole("spinbutton", { name: "Espiral el Mié 7 oct" }),
    ).toHaveValue(4);
    expect(screen.queryByRole("button", { name: /^Igual que / })).toBeNull();
  });

  it("no hay selector de otro día; sin productos en el primer día no se ofrece copiar", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct", "Mié 7 oct");
    // El primer día sigue vacío: el martes no ofrece copiar.
    fireEvent.click(screen.getByRole("tab", { name: /Mar 6/ }));
    expect(screen.queryByRole("button", { name: /^Igual que / })).toBeNull();
    // Con productos en el martes y el primero vacío, el miércoles tampoco: la base es siempre el primer día.
    mas("Concha", "Mar 6 oct", 7);
    fireEvent.click(boton(/Siguiente: Mié 7/));
    expect(screen.queryByRole("button", { name: /^Igual que / })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Copiar de otro día/)).toBeNull();
  });

  it("si se quita el primer día, el nuevo primer día pasa a ser la base de copiar", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct", "Mié 7 oct");
    mas("Espiral", "Lun 5 oct", 4);
    fireEvent.click(boton(/Siguiente: Mar 6/));
    mas("Concha", "Mar 6 oct", 2);
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Lun 5 de oct/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Quitar el día" }));
    fireEvent.click(boton(/Continuar/));
    // Ahora el primer día es el martes (Concha ×2) y el miércoles copia de él.
    await screen.findAllByRole("tab");
    fireEvent.click(screen.getByRole("tab", { name: /Mié 7/ }));
    expect(
      screen.getByRole("button", { name: "Igual que mar 6" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Igual que / }));
    expect(
      screen.getByRole("spinbutton", { name: "Concha el Mié 7 oct" }),
    ).toHaveValue(2);
  });

  it("pedido de 3 días: captura el primero, copia los otros con un toque y envía exactamente la forma del POST", async () => {
    crearPedido.mockResolvedValue(resultado);
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct", "Mié 7 oct");
    mas("Espiral", "Lun 5 oct", 4);
    mas("Concha", "Lun 5 oct", 2);
    fireEvent.click(boton(/Siguiente: Mar 6/));
    fireEvent.click(screen.getByRole("button", { name: /^Igual que / }));
    mas("Espiral", "Mar 6 oct"); // 5
    fireEvent.click(boton(/Siguiente: Mié 7/));
    fireEvent.click(screen.getByRole("button", { name: /^Igual que / })); // siempre del primer día: 4 y 2
    // Último día: «Ver resumen».
    fireEvent.click(boton(/Ver resumen/));
    await screen.findByText("Revisa tu pedido");

    // Primero por día (con «Editar»), luego el total de la semana por producto.
    expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(3);
    const total = screen
      .getByText("Total de la semana")
      .closest("div")!.parentElement!;
    expect(total).toHaveTextContent("19 pzas");
    expect(total).toHaveTextContent("Espiral13");
    expect(total).toHaveTextContent("Concha6");

    fireEvent.click(boton(/Enviar pedido/));
    await waitFor(() => expect(crearPedido).toHaveBeenCalledTimes(1));
    const [slug, entregas, nota] = crearPedido.mock.calls[0];
    expect(slug).toBe("banetto");
    expect(nota).toBeUndefined();
    expect(entregas).toEqual([
      {
        fecha: "2026-10-05",
        items: [
          { productId: "p1", cantidad: 4 },
          { productId: "p2", cantidad: 2 },
        ],
      },
      {
        fecha: "2026-10-06",
        items: [
          { productId: "p1", cantidad: 5 },
          { productId: "p2", cantidad: 2 },
        ],
      },
      {
        fecha: "2026-10-07",
        items: [
          { productId: "p1", cantidad: 4 },
          { productId: "p2", cantidad: 2 },
        ],
      },
    ]);
  });

  it("no se llega al resumen con un día intermedio vacío: el último día lo señala", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct", "Mié 7 oct");
    mas("Espiral", "Lun 5 oct");
    // Salta directo al último día dejando el martes vacío.
    fireEvent.click(screen.getByRole("tab", { name: /Mié 7/ }));
    mas("Espiral", "Mié 7 oct");
    expect(boton(/Ver resumen/)).toBeDisabled();
    expect(screen.getByText("Falta llenar el Mar 6")).toBeInTheDocument();
  });

  it("volver a los días: los que siguen conservan cantidades, el nuevo entra vacío y quitar uno con productos pide confirmación", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct");
    mas("Espiral", "Lun 5 oct", 3);
    fireEvent.click(boton(/Siguiente: Mar 6/));
    mas("Concha", "Mar 6 oct", 2);
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await screen.findByText("Elige tus días de entrega");

    // Quitar el martes (con productos): confirmación; «Conservarlo» no borra nada.
    fireEvent.click(screen.getByRole("checkbox", { name: /Mar 6 de oct/ }));
    expect(
      screen.getByRole("dialog", {
        name: "Se borrarán los productos del martes",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conservarlo" }));
    expect(
      screen.getByRole("checkbox", { name: /Mar 6 de oct/ }),
    ).toHaveAttribute("aria-checked", "true");
    // Confirmado: el martes sale; agregar el miércoles entra vacío; el lunes conserva lo suyo.
    fireEvent.click(screen.getByRole("checkbox", { name: /Mar 6 de oct/ }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar el día" }));
    expect(
      screen.getByRole("checkbox", { name: /Mar 6 de oct/ }),
    ).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("checkbox", { name: /Mié 7 de oct/ }));
    fireEvent.click(boton(/Continuar/));
    const tabs = await screen.findAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("Lun 53 pzs");
    expect(tabs[1]).toHaveTextContent("Mié 7vacío");
  });

  it("quitar un día SIN productos no pide confirmación", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct");
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Mar 6 de oct/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: /Mar 6 de oct/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("con dos semanas en el horizonte se elige una: el paso de días solo trae esa semana y el POST lleva fechas de una sola semana", async () => {
    crearPedido.mockResolvedValue(resultado);
    semanaAElegir = 1;
    montar([semana("2026-10-05"), semana("2026-10-12")]);
    await elegirDias("Vie 16 oct", "Lun 12 oct");
    // Sin pestañas agrupadas por semana.
    expect(screen.queryByText(/^Semana /)).toBeNull();
    mas("Espiral", "Lun 12 oct", 3);
    fireEvent.click(boton(/Siguiente: Vie 16/));
    fireEvent.click(screen.getByRole("button", { name: /^Igual que / }));
    fireEvent.click(boton(/Ver resumen/));
    await screen.findByText("Revisa tu pedido");
    expect(screen.getAllByText("Total de la semana")).toHaveLength(1);
    fireEvent.click(boton(/Enviar pedido/));
    await waitFor(() => expect(crearPedido).toHaveBeenCalledTimes(1));
    expect(crearPedido.mock.calls[0][1]).toEqual([
      { fecha: "2026-10-12", items: [{ productId: "p1", cantidad: 3 }] },
      { fecha: "2026-10-16", items: [{ productId: "p1", cantidad: 3 }] },
    ]);
  });

  it("Atrás desde los días regresa al selector de semana", async () => {
    montar([semana("2026-10-05"), semana("2026-10-12")]);
    await elegirDias("Lun 5 oct");
    fireEvent.click(screen.getByRole("button", { name: "Atrás" })); // del día a los días
    await screen.findByText("Elige tus días de entrega");
    fireEvent.click(screen.getByRole("button", { name: "Atrás" })); // de los días al selector
    await screen.findByText("Elige la semana de tu pedido");
  });

  it("regresar al selector y elegir la misma semana conserva lo capturado", async () => {
    montar([semana("2026-10-05"), semana("2026-10-12")]);
    await elegirDias("Lun 5 oct");
    mas("Espiral", "Lun 5 oct", 2);
    fireEvent.click(screen.getByRole("button", { name: "Atrás" })); // días
    fireEvent.click(screen.getByRole("button", { name: "Atrás" })); // semana
    fireEvent.click(screen.getAllByRole("button", { name: "Hacer pedido" })[0]);
    expect(
      await screen.findByRole("checkbox", { name: /Lun 5 de oct/ }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(boton(/Continuar/));
    expect((await screen.findAllByRole("tab"))[0]).toHaveTextContent("2 pzs");
  });

  it("cambiar a otra semana con productos pide confirmación y descarta lo capturado; sin productos cambia directo", async () => {
    montar([semana("2026-10-05"), semana("2026-10-12")]);
    await elegirDias("Lun 5 oct");
    mas("Espiral", "Lun 5 oct", 2);
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Hacer pedido" })[1]);
    expect(
      screen.getByRole("dialog", { name: "Cambiar de semana" }),
    ).toBeInTheDocument();
    // «Conservar» no cambia nada.
    fireEvent.click(
      screen.getByRole("button", { name: "Conservar mi pedido" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText("Elige la semana de tu pedido"),
    ).toBeInTheDocument();
    // Confirmar: otra semana, sin los días ni productos anteriores.
    fireEvent.click(screen.getAllByRole("button", { name: "Hacer pedido" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar de semana" }));
    const lunes = await screen.findByRole("checkbox", {
      name: /Lun 12 de oct/,
    });
    expect(lunes).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("checkbox", { name: /Lun 5 de oct/ })).toBeNull();
    // Sin productos capturados no hay confirmación.
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Hacer pedido" })[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      await screen.findByRole("checkbox", { name: /Lun 5 de oct/ }),
    ).toBeInTheDocument();
  });

  describe("favorito por día de la semana", () => {
    const barra = () =>
      screen.queryByRole("group", { name: "Acciones del día" });
    const btn = (n: string | RegExp) =>
      screen.queryByRole("button", { name: n });

    it("día vacío con favorito de ese día de la semana: «Mi favorito» llena el día con un toque y pasa a «Tu lunes favorito ✓»", async () => {
      montar(
        [semana("2026-10-05")],
        favoritoDe([
          ["p1", "Espiral", { LUNES: 4, MIERCOLES: 9 }],
          ["p2", "Concha", { LUNES: 2 }],
        ]),
      );
      await elegirDias("Lun 5 oct", "Mar 6 oct");
      // Es el primer día: no hay «Igual que…»; la barra tiene la misma forma con un solo botón, a todo lo ancho y principal.
      expect(btn(/^Igual que /)).toBeNull();
      expect(barra()).toHaveTextContent("¿Cómo empiezas el lunes?");
      expect(btn("Mi favorito")!.className).toContain("bg-mayoreo-button");
      expect(btn("Mi favorito")!.parentElement!.className).toContain(
        "grid-cols-1",
      );
      fireEvent.click(btn("Mi favorito")!);
      expect(
        screen.getByRole("spinbutton", { name: "Espiral el Lun 5 oct" }),
      ).toHaveValue(4);
      expect(
        screen.getByRole("spinbutton", { name: "Concha el Lun 5 oct" }),
      ).toHaveValue(2);
      // Idéntico al favorito: ✓ y sin botón.
      expect(barra()).toHaveTextContent("Tu lunes favorito ✓");
      expect(btn("Mi favorito")).toBeNull();
      expect(btn("Guardar favorito")).toBeNull();
      // El martes no tiene favorito (solo hay lunes y miércoles): día vacío, solo «Igual que lun 5», a todo lo ancho.
      fireEvent.click(screen.getByRole("tab", { name: /Mar 6/ }));
      expect(barra()).toHaveTextContent("¿Cómo empiezas el martes?");
      expect(btn("Mi favorito")).toBeNull();
      expect(btn("Igual que lun 5")!.className).toContain("bg-mayoreo-button");
      expect(btn("Igual que lun 5")!.parentElement!.className).toContain(
        "grid-cols-1",
      );
    });

    it("sin favorito ni copiar (primer día) no hay barra", async () => {
      montar();
      await elegirDias("Lun 5 oct");
      expect(barra()).toBeNull();
    });

    it("día vacío que no es el primero con favorito propio: una sola decisión: «Igual que lun 5» (principal) y «Mi favorito» (secundario), lado a lado", async () => {
      montar(
        [semana("2026-10-05")],
        favoritoDe([["p2", "Concha", { MARTES: 7 }]]),
      );
      await elegirDias("Lun 5 oct", "Mar 6 oct");
      mas("Espiral", "Lun 5 oct", 3);
      fireEvent.click(boton(/Siguiente: Mar 6/));
      const b = barra()!;
      expect(b).toHaveTextContent("¿Cómo empiezas el martes?");
      expect(b).not.toHaveTextContent("Tu martes favorito");
      const copiar = btn(/^Igual que /)!;
      const usar = btn("Mi favorito")!;
      expect(b.contains(copiar) && b.contains(usar)).toBe(true);
      // Igual que… es el principal (relleno oscuro) con ícono; Mi favorito, el secundario (con borde) con ícono; mismo ancho.
      expect(copiar.className).toContain("bg-mayoreo-button");
      expect(usar.className).not.toContain("bg-mayoreo-button");
      expect(copiar.parentElement!.className).toContain("grid-cols-2");
      expect(copiar.querySelector("svg")).not.toBeNull();
      expect(usar.querySelector("svg")).not.toBeNull();
      fireEvent.click(usar);
      expect(
        screen.getByRole("spinbutton", { name: "Concha el Mar 6 oct" }),
      ).toHaveValue(7);
      expect(
        screen.getByRole("spinbutton", { name: "Espiral el Mar 6 oct" }),
      ).toHaveValue(null);
    });

    it("día con productos sin favorito: «¿Siempre pides así los lunes?» → Guardar favorito guarda ese día y pasa a ✓; si cambia después, vuelve a ofrecer guardar", async () => {
      guardarFavoritoDia.mockResolvedValue(
        favoritoDe([["p1", "Espiral", { LUNES: 3 }]]),
      );
      montar();
      await elegirDias("Lun 5 oct");
      expect(barra()).toBeNull(); // día vacío
      mas("Espiral", "Lun 5 oct", 3);
      expect(barra()).toHaveTextContent("¿Siempre pides así los lunes?");
      fireEvent.click(btn("Guardar favorito")!);
      await waitFor(() =>
        expect(barra()).toHaveTextContent("Tu lunes favorito ✓"),
      );
      expect(guardarFavoritoDia).toHaveBeenCalledWith("banetto", "LUNES", [
        { productId: "p1", cantidad: 3 },
      ]);
      expect(btn("Guardar favorito")).toBeNull();
      // Cambia el día guardado → vuelve a ofrecer guardar.
      mas("Espiral", "Lun 5 oct");
      expect(barra()).toHaveTextContent("¿Siempre pides así los lunes?");
      expect(btn("Guardar favorito")).not.toBeNull();
    });

    it("si el día ya tenía favorito, pide confirmación antes de reemplazarlo", async () => {
      guardarFavoritoDia.mockResolvedValue(
        favoritoDe([["p1", "Espiral", { LUNES: 5 }]]),
      );
      montar(
        [semana("2026-10-05")],
        favoritoDe([["p2", "Concha", { LUNES: 2 }]]),
      );
      await elegirDias("Lun 5 oct");
      mas("Espiral", "Lun 5 oct", 5);
      fireEvent.click(btn("Guardar favorito")!);
      expect(
        screen.getByRole("dialog", { name: "Reemplazar tu lunes favorito" }),
      ).toBeInTheDocument();
      // «Conservar» no guarda nada.
      fireEvent.click(btn("Conservar el actual")!);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(guardarFavoritoDia).not.toHaveBeenCalled();
      fireEvent.click(btn("Guardar favorito")!);
      fireEvent.click(btn("Reemplazar favorito")!);
      await waitFor(() =>
        expect(guardarFavoritoDia).toHaveBeenCalledWith("banetto", "LUNES", [
          { productId: "p1", cantidad: 5 },
        ]),
      );
      await waitFor(() =>
        expect(barra()).toHaveTextContent("Tu lunes favorito ✓"),
      );
    });

    it("guardar el miércoles no toca el lunes: cada día de la semana tiene su propio favorito", async () => {
      guardarFavoritoDia.mockResolvedValue(
        favoritoDe([
          ["p1", "Espiral", { LUNES: 3 }],
          ["p2", "Concha", { MIERCOLES: 6 }],
        ]),
      );
      montar(
        [semana("2026-10-05")],
        favoritoDe([["p1", "Espiral", { LUNES: 3 }]]),
      );
      await elegirDias("Lun 5 oct", "Mié 7 oct");
      fireEvent.click(btn("Mi favorito")!); // lunes lleno con su favorito
      fireEvent.click(boton(/Siguiente: Mié 7/));
      mas("Concha", "Mié 7 oct", 6);
      // El miércoles no tenía favorito: no hay confirmación.
      fireEvent.click(btn("Guardar favorito")!);
      await waitFor(() =>
        expect(barra()).toHaveTextContent("Tu miércoles favorito ✓"),
      );
      expect(guardarFavoritoDia).toHaveBeenCalledWith("banetto", "MIERCOLES", [
        { productId: "p2", cantidad: 6 },
      ]);
      fireEvent.click(screen.getByRole("tab", { name: /Lun 5/ }));
      expect(barra()).toHaveTextContent("Tu lunes favorito ✓");
    });

    it("al usar un favorito con productos que ya no están disponibles, el día se llena sin ellos y se avisa con su nombre", async () => {
      montar(
        [semana("2026-10-05")],
        favoritoDe([["p2", "Concha", { LUNES: 2 }]], ["Cuernito"]),
      );
      await elegirDias("Lun 5 oct");
      fireEvent.click(btn("Mi favorito")!);
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Cuernito ya no está disponible",
      );
      expect(
        screen.getByRole("spinbutton", { name: "Concha el Lun 5 oct" }),
      ).toHaveValue(2);
    });

    it("si falla guardar, se avisa y el día sigue como estaba", async () => {
      guardarFavoritoDia.mockRejectedValue(
        new Error("Uno de los productos ya no está disponible"),
      );
      montar();
      await elegirDias("Lun 5 oct");
      mas("Espiral", "Lun 5 oct");
      fireEvent.click(btn("Guardar favorito")!);
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Uno de los productos ya no está disponible",
      );
      expect(btn("Guardar favorito")).not.toBeNull();
    });

    it("si no carga el favorito, el flujo sigue funcionando (con Copiar) y sin acciones de favorito", async () => {
      montar([semana("2026-10-05")], new Error("sin red"));
      await elegirDias("Lun 5 oct", "Mar 6 oct");
      mas("Espiral", "Lun 5 oct", 2);
      expect(btn("Guardar favorito")).toBeNull();
      fireEvent.click(boton(/Siguiente: Mar 6/));
      expect(btn(/^Igual que /)).not.toBeNull();
      expect(btn("Mi favorito")).toBeNull();
      expect(btn("Mi favorito")).toBeNull();
      fireEvent.click(btn(/^Igual que /)!);
      expect(
        screen.getByRole("spinbutton", { name: "Espiral el Mar 6 oct" }),
      ).toHaveValue(2);
    });
  });

  it("«Editar» en el resumen vuelve a ese día y el botón regresa al resumen", async () => {
    montar();
    await elegirDias("Lun 5 oct", "Mar 6 oct");
    mas("Espiral", "Lun 5 oct");
    fireEvent.click(boton(/Siguiente: Mar 6/));
    mas("Espiral", "Mar 6 oct");
    fireEvent.click(boton(/Ver resumen/));
    await screen.findByText("Revisa tu pedido");
    fireEvent.click(screen.getByRole("button", { name: "Editar Lun 5 oct" }));
    mas("Espiral", "Lun 5 oct", 2);
    fireEvent.click(boton(/Volver al resumen/));
    await screen.findByText("Revisa tu pedido");
    expect(
      screen.getByText("Total de la semana").closest("div")!.parentElement,
    ).toHaveTextContent("Espiral4");
  });
});

describe("menú: botón de cuenta", () => {
  const base = {
    negocio: { nombre: "Banetto" },
    telefonoTerminacion: "6915",
    cliente: { id: "c1", nombre: "Cafe Entredos" },
    requiereSeleccion: false,
  };
  const montar = (clientes: { id: string; nombre: string }[]) => {
    fetchCalendario.mockResolvedValue(calendario([semana("2026-10-05")]));
    const onCambiarCliente = vi.fn();
    render(
      <MenuPantalla
        slug="banetto"
        sesion={{ ...base, clientes }}
        onCrear={() => {}}
        onVerPedidos={() => {}}
        onModificar={() => {}}
        onCambiarCliente={onCambiarCliente}
        onCerrada={() => {}}
      />,
    );
    return { onCambiarCliente };
  };

  it("un solo cliente: el menú solo trae «Cerrar sesión»", () => {
    montar([{ id: "c1", nombre: "Cafe Entredos" }]);
    expect(screen.queryByText("Cerrar sesión")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tu cuenta" }));
    expect(
      screen.getByRole("menuitem", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Cambiar de cliente" }),
    ).toBeNull();
  });

  it("varios clientes: «Cambiar de cliente» hace lo de siempre y cierra el menú; tocar fuera también lo cierra", () => {
    const { onCambiarCliente } = montar([
      { id: "c1", nombre: "Cafe Entredos" },
      { id: "c2", nombre: "Cafe Dos" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Tu cuenta" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Cambiar de cliente" }),
    );
    expect(onCambiarCliente).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tu cuenta" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
