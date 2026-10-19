"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { capturar } from "@/lib/analitica";
import {
  PortalError,
  crearPedido,
  fetchCalendario,
  fetchCatalogo,
  fetchFavorito,
  guardarFavoritoDia,
  problemasDeError,
  type CalendarioPortal,
  type CatalogoPortal,
  type FavoritoPortal,
  type PortalSesion,
  type ProblemaFechaPortal,
  type ResultadoPedidoPortal,
} from "@/lib/portal-api";
import { etiquetaFechaLarga } from "@/lib/portal-calendario-formato";
import {
  construirEntregas,
  copiarDia,
  diaSemanaDeFecha,
  lineasDeFavoritoDia,
  losDia,
  nombreDiaSemana,
  piezasDia,
  ponerCantidad,
  sinDiasQuitados,
  totalesPorSemana,
  usarFavoritoDia,
  type PorDia,
} from "@/lib/portal-pedido-modelo";
import {
  AVISO,
  BTN_PRIMARIO,
  BTN_SECUNDARIO,
  ERROR,
  WRAPPER,
} from "../estilos";
import EncabezadoPantalla from "../encabezado-pantalla";
import AlertaFlotante from "../alerta-flotante";
import ModalPortal from "../modal-portal";
import PasoConfirmacion from "./paso-confirmacion";
import PasoDia from "./paso-dia";
import PasoDias from "./paso-dias";
import PasoResumen from "./paso-resumen";
import PasoSemana from "./paso-semana";

type Paso = "semana" | "dias" | "dia" | "resumen" | "confirmacion";
const TITULO: Record<Paso, string | undefined> = {
  semana: "Elige la semana de tu pedido",
  dias: "Elige tus días de entrega",
  dia: "¿Qué quieres cada día?",
  resumen: "Revisa tu pedido",
  confirmacion: undefined,
};

interface Datos {
  calendario: CalendarioPortal;
  catalogo: CatalogoPortal;
}

interface Props {
  slug: string;
  sesion: PortalSesion;
  onSalir: () => void;
  onSesionTerminada: () => void;
}

const nuevaLlave = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random()}`;

// Crear pedido (un pedido = una semana): semana → días de esa semana → un paso por cada día elegido → resumen → confirmación. El cliente captura lo que recibe cada día; el
// servidor deriva el total por producto y decide qué días se pueden pedir, los precios, el descuento y el mínimo.
export default function CrearPedido({
  slug,
  sesion,
  onSalir,
  onSesionTerminada,
}: Props) {
  const clienteId = sesion.cliente?.id;
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [paso, setPaso] = useState<Paso>("semana");
  // Semana (lunes, YYYY-MM-DD) del pedido que se está armando.
  const [semanaInicio, setSemanaInicio] = useState<string | null>(null);
  // Semana a la que se quiere cambiar habiendo ya capturado productos: espera la confirmación del cliente.
  const [cambiarSemana, setCambiarSemana] = useState<string | null>(null);
  const [fechas, setFechas] = useState<string[]>([]);
  // fecha → productId → cantidad: lo que se recibe cada día. Es lo único que se captura.
  const [porDia, setPorDia] = useState<PorDia>({});
  const [fechaActiva, setFechaActiva] = useState("");
  // Se llegó a un día desde «Editar» del resumen: al terminar se regresa al resumen.
  const [desdeResumen, setDesdeResumen] = useState(false);
  // Día que se quiere quitar y ya tiene productos: espera la confirmación del cliente.
  const [quitarFecha, setQuitarFecha] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  // Favoritos por día de la semana. null = no han cargado o falló la carga: el flujo sigue sin acciones de favorito.
  const [favorito, setFavorito] = useState<FavoritoPortal | null>(null);
  const [guardandoFavorito, setGuardandoFavorito] = useState(false);
  // Fecha cuyo favorito se quiere reemplazar (ya existía uno para ese día de la semana): espera la confirmación.
  const [reemplazarFavorito, setReemplazarFavorito] = useState<string | null>(
    null,
  );
  // Alerta flotante (desaparece sola a los 3 s): avisos de «Usar favorito» y errores al guardarlo.
  const [alerta, setAlerta] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<ProblemaFechaPortal[]>([]);
  const [resultado, setResultado] = useState<ResultadoPedidoPortal | null>(
    null,
  );
  const llave = useRef<{ firma: string; key: string } | null>(null);
  // Analítica: `producto_agregado` solo la primera vez que se agrega un producto en esta sesión de armado.
  const productoAgregadoEnviado = useRef(false);
  const catalogoVistoEnviado = useRef(false);
  useEffect(() => {
    if (paso !== "resumen") return;
    const piezas = Object.entries(porDia)
      .filter(([f]) => fechas.includes(f))
      .reduce((s, [, l]) => s + piezasDia(l), 0);
    capturar("resumen_visto", {
      slug,
      semana: semanaInicio ?? undefined,
      dias: fechas.length,
      piezas,
    });
    // Solo al entrar al resumen, no en cada cambio de cantidades.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso]);

  const terminarSesion = (e: unknown) => {
    if (e instanceof PortalError && e.status === 401) {
      onSesionTerminada();
      return true;
    }
    return false;
  };

  useEffect(() => {
    let activo = true;
    void Promise.all([fetchCalendario(slug), fetchCatalogo(slug)])
      .then(([calendario, catalogo]) => {
        if (!activo) return;
        setDatos({ calendario, catalogo });
        if (!catalogoVistoEnviado.current) {
          catalogoVistoEnviado.current = true;
          capturar("catalogo_visto", { slug });
        }
      })
      .catch((e: unknown) => {
        if (!activo) return;
        if (e instanceof PortalError && e.status === 401)
          return onSesionTerminada();
        setErrorCarga(
          e instanceof Error
            ? e.message
            : "No pudimos cargar tu calendario y tu catálogo",
        );
      });
    return () => {
      activo = false;
    };
    // onSesionTerminada es estable en la práctica (setState del padre); se vuelve a cargar si cambia el cliente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, clienteId]);

  // El favorito se carga una vez al entrar al flujo, aparte del calendario y el catálogo: si falla, no estorba.
  useEffect(() => {
    let activo = true;
    fetchFavorito(slug)
      .then((f) => {
        if (activo) setFavorito(f);
      })
      .catch(() => {
        if (activo) setFavorito(null);
      });
    return () => {
      activo = false;
    };
  }, [slug, clienteId]);

  const precios = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of datos?.catalogo.categories ?? [])
      for (const p of c.products) m[p.id] = p.precio;
    return m;
  }, [datos]);
  const nombres = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of datos?.catalogo.categories ?? [])
      for (const p of c.products) m.set(p.id, p.nombre);
    return m;
  }, [datos]);

  if (errorCarga) {
    return (
      <Contenedor titulo="Crear pedido" onAtras={onSalir}>
        <p className={ERROR}>{errorCarga}</p>
      </Contenedor>
    );
  }
  if (!datos) {
    return (
      <Contenedor titulo="Crear pedido" onAtras={onSalir}>
        <p className="text-sm text-mayoreo-ink-soft">
          Cargando tu calendario y tu catálogo…
        </p>
      </Contenedor>
    );
  }
  const { calendario, catalogo } = datos;

  const semana = calendario.semanas.find(
    (x) => x.semanaInicio === semanaInicio,
  );
  const entregas = construirEntregas(porDia, fechas);
  const totalSemana = totalesPorSemana(
    entregas,
    semana ? [semana] : [],
    precios,
    catalogo.descuentoPorcentaje,
    catalogo.minimoPiezas,
  )[0];

  function aplicarSemana(inicio: string) {
    if (inicio !== semanaInicio) {
      // Otra semana: se descarta lo capturado (los días elegidos eran de la anterior).
      setFechas([]);
      setPorDia({});
      setFechaActiva("");
      setSemanaInicio(inicio);
    }
    setProblemas([]);
    setPaso("dias");
  }

  function elegirSemana(inicio: string) {
    const hayProductos = Object.values(porDia).some((l) => piezasDia(l) > 0);
    if (semanaInicio && inicio !== semanaInicio && hayProductos)
      setCambiarSemana(inicio);
    else aplicarSemana(inicio);
  }

  function quitarFechaYa(f: string) {
    setFechas((prev) => prev.filter((x) => x !== f));
    setPorDia((prev) =>
      sinDiasQuitados(
        prev,
        fechas.filter((x) => x !== f),
      ),
    );
  }

  function toggleFecha(f: string) {
    setProblemas([]);
    if (!fechas.includes(f)) {
      // Un día agregado entra vacío.
      setFechas((prev) => [...prev, f].sort());
      return;
    }
    // Quitar un día con productos pide confirmación antes de borrarlos.
    if (piezasDia(porDia[f]) > 0) setQuitarFecha(f);
    else quitarFechaYa(f);
  }

  function usarFavorito(fecha: string) {
    if (!favorito) return;
    const { lineas, avisos } = usarFavoritoDia(
      favorito,
      diaSemanaDeFecha(fecha),
      Object.values(catalogo.categories).flatMap((c) => c.products),
    );
    if (Object.keys(lineas).length > 0)
      setPorDia((prev) => ({ ...prev, [fecha]: lineas }));
    if (avisos.length > 0) setAlerta(avisos.join(". "));
  }

  // Guardar el favorito del día de la semana de esta fecha. Si ya existía uno para ese día, antes se confirma.
  function pedirGuardarFavorito(fecha: string) {
    const dia = diaSemanaDeFecha(fecha);
    const existe = (favorito?.favorito?.lineas ?? []).some(
      (l) => (l.dias[dia] ?? 0) > 0,
    );
    if (existe) setReemplazarFavorito(fecha);
    else void guardarFavorito(fecha);
  }

  async function guardarFavorito(fecha: string) {
    setGuardandoFavorito(true);
    try {
      const r = await guardarFavoritoDia(
        slug,
        diaSemanaDeFecha(fecha),
        lineasDeFavoritoDia(porDia[fecha] ?? {}),
      );
      setFavorito(r);
    } catch (e) {
      if (terminarSesion(e)) return;
      setAlerta(
        e instanceof Error
          ? e.message
          : "No pudimos guardar tu favorito. Intenta de nuevo",
      );
    } finally {
      setGuardandoFavorito(false);
    }
  }

  function irADia(f: string) {
    setFechaActiva(f);
    setPaso("dia");
  }

  function continuarDesdeDias() {
    setProblemas([]);
    setDesdeResumen(false);
    irADia(fechas.includes(fechaActiva) ? fechaActiva : fechas[0]);
  }

  async function refrescar(): Promise<void> {
    try {
      const [c, k] = await Promise.all([
        fetchCalendario(slug),
        fetchCatalogo(slug),
      ]);
      setDatos({ calendario: c, catalogo: k });
    } catch (e) {
      terminarSesion(e);
    }
  }

  async function enviar() {
    setError(null);
    setProblemas([]);
    setEnviando(true);
    const firma = JSON.stringify({ entregas, nota });
    if (!llave.current || llave.current.firma !== firma)
      llave.current = { firma, key: nuevaLlave() };
    try {
      const r = await crearPedido(
        slug,
        entregas,
        nota.trim() || undefined,
        llave.current.key,
      );
      setResultado(r);
      setPaso("confirmacion");
      capturar("pedido_confirmado", {
        slug,
        semana: semanaInicio ?? undefined,
        dias: entregas.length,
        piezas: entregas.reduce(
          (s, e) => s + e.items.reduce((t, i) => t + i.cantidad, 0),
          0,
        ),
      });
    } catch (e) {
      if (terminarSesion(e)) return;
      const fallos = problemasDeError(e);
      if (fallos.length > 0) {
        // El calendario cambió mientras armabas el pedido: se quitan esas fechas, los demás días conservan sus productos.
        const malas = new Set(fallos.map((p) => p.fecha));
        const restantes = fechas.filter((f) => !malas.has(f));
        setFechas(restantes);
        setPorDia((prev) => sinDiasQuitados(prev, restantes));
        setProblemas(fallos);
        setPaso("dias");
        await refrescar();
      } else {
        setError(
          e instanceof Error
            ? e.message
            : "No pudimos crear tu pedido. Intenta de nuevo",
        );
        if (e instanceof PortalError && e.status === 409) await refrescar();
      }
      llave.current = null;
    } finally {
      setEnviando(false);
    }
  }

  const nombreCliente = sesion.cliente?.nombre ?? "";
  // «Atrás» de un día lleva a la pantalla de días (única forma de quitar o agregar días); el del resumen, al último día.
  const atras =
    paso === "semana" || paso === "confirmacion"
      ? onSalir
      : paso === "dias"
        ? () => setPaso("semana")
        : paso === "dia"
          ? () => setPaso("dias")
          : () => {
              setDesdeResumen(false);
              irADia(fechas[fechas.length - 1]);
            };

  return (
    <Contenedor
      titulo={TITULO[paso]}
      onAtras={paso === "confirmacion" ? undefined : atras}
    >
      {problemas.length > 0 && paso === "dias" && (
        <div className="flex flex-col gap-1">
          {problemas.map((p) => (
            <p key={p.fecha} className={ERROR}>
              {p.mensaje}
            </p>
          ))}
          <p className={AVISO}>
            Actualizamos tu calendario. Elige de nuevo tus días; los demás días
            conservan sus productos.
          </p>
        </div>
      )}
      {paso === "semana" && (
        <PasoSemana
          cliente={nombreCliente}
          calendario={calendario}
          onElegir={(x) => elegirSemana(x.semanaInicio)}
        />
      )}
      {paso === "dias" && semana && (
        <PasoDias
          cliente={nombreCliente}
          calendario={calendario}
          semana={semana}
          fechas={fechas}
          onToggle={toggleFecha}
          onContinuar={continuarDesdeDias}
        />
      )}
      {paso === "dia" && fechaActiva && (
        <PasoDia
          catalogo={catalogo}
          fechas={fechas}
          fechaActiva={fechaActiva}
          porDia={porDia}
          desdeResumen={desdeResumen}
          onCantidad={(f, id, n) => {
            if (n > 0 && !productoAgregadoEnviado.current) {
              productoAgregadoEnviado.current = true;
              capturar("producto_agregado", {
                slug,
                semana: semanaInicio ?? undefined,
                dias: fechas.length,
              });
            }
            setPorDia((prev) => ponerCantidad(prev, f, id, n));
          }}
          onCopiar={(origen, destino) =>
            setPorDia((prev) => copiarDia(prev, origen, destino))
          }
          favorito={favorito}
          guardandoFavorito={guardandoFavorito}
          onUsarFavorito={usarFavorito}
          onGuardarFavorito={pedirGuardarFavorito}
          onIr={irADia}
          onResumen={() => {
            setDesdeResumen(false);
            setPaso("resumen");
          }}
        />
      )}
      {paso === "resumen" && totalSemana && (
        <PasoResumen
          entregas={entregas}
          nombres={nombres}
          semana={totalSemana}
          descuentoPorcentaje={catalogo.descuentoPorcentaje}
          minimoPiezas={catalogo.minimoPiezas}
          nota={nota}
          onNota={setNota}
          enviando={enviando}
          error={error}
          problemas={problemas}
          onEditarDia={(f) => {
            setDesdeResumen(true);
            irADia(f);
          }}
          onEnviar={() => void enviar()}
        />
      )}
      {paso === "confirmacion" && resultado && (
        <PasoConfirmacion
          resultado={resultado}
          cliente={nombreCliente}
          numeroAtencion={calendario.numeroAtencion}
          horaEntrega={calendario.horaEntrega}
          ubicacion={calendario.ubicacion ?? null}
          onVolver={onSalir}
        />
      )}
      {alerta && (
        <AlertaFlotante mensaje={alerta} onCerrar={() => setAlerta(null)} />
      )}
      {reemplazarFavorito && (
        <ModalPortal
          titulo={`Reemplazar tu ${nombreDiaSemana(diaSemanaDeFecha(reemplazarFavorito))} favorito`}
          onCerrar={() => setReemplazarFavorito(null)}
        >
          <p className="text-sm text-mayoreo-ink-soft">
            Ya tienes un favorito para{" "}
            {losDia(diaSemanaDeFecha(reemplazarFavorito))}. Se reemplazará por
            lo que capturaste hoy.
          </p>
          <div className="flex flex-col gap-2">
            <button
              className={BTN_PRIMARIO}
              onClick={() => {
                const f = reemplazarFavorito;
                setReemplazarFavorito(null);
                void guardarFavorito(f);
              }}
            >
              Reemplazar favorito
            </button>
            <button
              className={BTN_SECUNDARIO}
              onClick={() => setReemplazarFavorito(null)}
            >
              Conservar el actual
            </button>
          </div>
        </ModalPortal>
      )}
      {cambiarSemana && (
        <ModalPortal
          titulo="Cambiar de semana"
          onCerrar={() => setCambiarSemana(null)}
        >
          <p className="text-sm text-mayoreo-ink-soft">
            Se descartará lo que capturaste para la semana anterior.
          </p>
          <div className="flex flex-col gap-2">
            <button
              className={BTN_PRIMARIO}
              onClick={() => {
                aplicarSemana(cambiarSemana);
                setCambiarSemana(null);
              }}
            >
              Cambiar de semana
            </button>
            <button
              className={BTN_SECUNDARIO}
              onClick={() => setCambiarSemana(null)}
            >
              Conservar mi pedido
            </button>
          </div>
        </ModalPortal>
      )}
      {quitarFecha && (
        <ModalPortal
          titulo={`Se borrarán los productos del ${etiquetaFechaLarga(quitarFecha).split(" ")[0]}`}
          onCerrar={() => setQuitarFecha(null)}
        >
          <p className="text-sm text-mayoreo-ink-soft">
            Quitas el {etiquetaFechaLarga(quitarFecha)} y se pierde lo que
            habías capturado en ese día.
          </p>
          <div className="flex flex-col gap-2">
            <button
              className={BTN_PRIMARIO}
              onClick={() => {
                quitarFechaYa(quitarFecha);
                setQuitarFecha(null);
              }}
            >
              Quitar el día
            </button>
            <button
              className={BTN_SECUNDARIO}
              onClick={() => setQuitarFecha(null)}
            >
              Conservarlo
            </button>
          </div>
        </ModalPortal>
      )}
    </Contenedor>
  );
}

function Contenedor({
  titulo,
  onAtras,
  children,
}: {
  titulo?: string;
  onAtras?: () => void;
  children: React.ReactNode;
}) {
  const conEncabezado = !!onAtras || !!titulo;
  return (
    <main className={WRAPPER}>
      {conEncabezado && (
        <EncabezadoPantalla titulo={titulo} onAtras={onAtras} />
      )}
      {children}
    </main>
  );
}
