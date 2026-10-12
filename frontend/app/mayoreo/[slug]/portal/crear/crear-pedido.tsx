"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PortalError,
  crearPedido,
  fetchCalendario,
  fetchCatalogo,
  fetchFavorito,
  guardarFavorito,
  problemasDeError,
  type CalendarioPortal,
  type CatalogoPortal,
  type FavoritoPortal,
  type PortalSesion,
  type ProblemaFechaPortal,
  type ResultadoPedidoPortal,
} from "@/lib/portal-api";
import {
  aplicarFavorito,
  construirEntregas,
  favoritoDesdeSeleccion,
  repartirParejo,
  sumaDistribucion,
  totalesPorSemana,
  type Carrito,
  type Distribucion,
} from "@/lib/portal-pedido-modelo";
import { AVISO, BTN_ENLACE, ERROR } from "../estilos";
import AlertaFlotante from "../alerta-flotante";
import PasoCatalogo from "./paso-catalogo";
import PasoConfirmacion from "./paso-confirmacion";
import PasoDias from "./paso-dias";
import PasoDistribucion from "./paso-distribucion";
import PasoResumen from "./paso-resumen";

type Paso = "dias" | "catalogo" | "distribucion" | "resumen" | "confirmacion";
const TITULO: Record<Paso, string> = {
  dias: "Días de entrega",
  catalogo: "Productos",
  distribucion: "Reparto por día",
  resumen: "Resumen",
  confirmacion: "Listo",
};
const ANTERIOR: Partial<Record<Paso, Paso>> = {
  catalogo: "dias",
  distribucion: "catalogo",
  resumen: "distribucion",
};

interface Datos {
  calendario: CalendarioPortal;
  catalogo: CatalogoPortal;
  favorito: FavoritoPortal;
}

interface Props {
  slug: string;
  sesion: PortalSesion;
  onSalir: () => void;
  onSesionTerminada: () => void;
}

const MENSAJE_FAVORITO_NO_APLICADO =
  "Tu favorito no se pudo aplicar: ya no hay días disponibles para sus entregas. Elige los días a mano.";

const nuevaLlave = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random()}`;

// Crear pedido (4d): días → productos → reparto por día → resumen → confirmación. El servidor decide qué días se pueden
// pedir, los precios, el descuento y el mínimo; aquí solo se arma el pedido y se muestra.
export default function CrearPedido({
  slug,
  sesion,
  onSalir,
  onSesionTerminada,
}: Props) {
  const clienteId = sesion.cliente?.id;
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [paso, setPaso] = useState<Paso>("dias");
  const [fechas, setFechas] = useState<string[]>([]);
  const [carrito, setCarrito] = useState<Carrito>({});
  const [dist, setDist] = useState<Distribucion>({});
  const [nota, setNota] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  // Alerta flotante (desaparece sola a los 3 s): hoy solo «el favorito no se pudo aplicar».
  const [alerta, setAlerta] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<ProblemaFechaPortal[]>([]);
  const [resultado, setResultado] = useState<ResultadoPedidoPortal | null>(
    null,
  );
  const [favoritoEstado, setFavoritoEstado] = useState<
    "ninguno" | "guardando" | "guardado" | "error"
  >("ninguno");
  const llave = useRef<{ firma: string; key: string } | null>(null);

  const terminarSesion = (e: unknown) => {
    if (e instanceof PortalError && e.status === 401) {
      onSesionTerminada();
      return true;
    }
    return false;
  };

  useEffect(() => {
    let activo = true;
    void Promise.all([
      fetchCalendario(slug),
      fetchCatalogo(slug),
      fetchFavorito(slug),
    ])
      .then(([calendario, catalogo, favorito]) => {
        if (activo) setDatos({ calendario, catalogo, favorito });
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
  const { calendario, catalogo, favorito } = datos;

  const entregas = construirEntregas(carrito, dist, fechas);
  const totales = totalesPorSemana(
    entregas,
    calendario.semanas,
    precios,
    catalogo.descuentoPorcentaje,
    catalogo.minimoPiezas,
  );

  function toggleFecha(f: string) {
    setProblemas([]);
    setFechas((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f].sort(),
    );
  }

  function usarFavorito() {
    const r = aplicarFavorito(
      favorito,
      calendario,
      Object.values(catalogo.categories).flatMap((c) => c.products),
    );
    if (!r || r.fechas.length === 0) {
      setAvisos(r?.avisos ?? []);
      setAlerta(MENSAJE_FAVORITO_NO_APLICADO);
      return;
    }
    setFechas(r.fechas);
    setCarrito(r.carrito);
    setDist(r.dist);
    setAvisos(r.avisos);
    setProblemas([]);
    setPaso("catalogo");
  }

  function setCantidad(id: string, cantidad: number) {
    setCarrito((prev) => {
      const sig = { ...prev };
      if (cantidad > 0) sig[id] = cantidad;
      else delete sig[id];
      return sig;
    });
  }

  function irADistribucion() {
    const ordenadas = [...fechas].sort();
    setDist((prev) => {
      const sig: Distribucion = {};
      for (const [id, total] of Object.entries(carrito)) {
        if (total <= 0) continue;
        // Solo se conserva lo ya repartido si sigue sumando el total sobre las fechas actuales.
        sig[id] =
          sumaDistribucion(prev[id], ordenadas) === total
            ? prev[id]
            : repartirParejo(total, ordenadas);
      }
      return sig;
    });
    setPaso("distribucion");
  }

  async function refrescar(): Promise<void> {
    try {
      const [c, k, f] = await Promise.all([
        fetchCalendario(slug),
        fetchCatalogo(slug),
        fetchFavorito(slug),
      ]);
      setDatos({ calendario: c, catalogo: k, favorito: f });
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
    } catch (e) {
      if (terminarSesion(e)) return;
      const fallos = problemasDeError(e);
      if (fallos.length > 0) {
        // El calendario cambió mientras armabas el pedido: se quitan esas fechas, se conserva el carrito y se vuelve a los días.
        const malas = new Set(fallos.map((p) => p.fecha));
        setFechas((prev) => prev.filter((f) => !malas.has(f)));
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

  async function guardarComoFavorito() {
    const lineas = favoritoDesdeSeleccion(carrito, dist, fechas, calendario);
    if (lineas.length === 0) return setFavoritoEstado("error");
    setFavoritoEstado("guardando");
    try {
      const f = await guardarFavorito(slug, lineas);
      setDatos((d) => (d ? { ...d, favorito: f } : d));
      setFavoritoEstado("guardado");
    } catch (e) {
      if (terminarSesion(e)) return;
      setFavoritoEstado("error");
    }
  }

  const nombreCliente = sesion.cliente?.nombre ?? "";
  const atras =
    paso === "dias" || paso === "confirmacion"
      ? onSalir
      : () => setPaso(ANTERIOR[paso] ?? "dias");

  return (
    <Contenedor
      titulo={TITULO[paso]}
      onAtras={paso === "confirmacion" ? undefined : atras}
    >
      {avisos.length > 0 && paso !== "confirmacion" && (
        <div className="flex flex-col gap-1">
          {avisos.map((a) => (
            <p key={a} className={AVISO}>
              {a}
            </p>
          ))}
        </div>
      )}
      {problemas.length > 0 && paso === "dias" && (
        <div className="flex flex-col gap-1">
          {problemas.map((p) => (
            <p key={p.fecha} className={ERROR}>
              {p.mensaje}
            </p>
          ))}
          <p className={AVISO}>
            Actualizamos tu calendario. Elige de nuevo tus días; tus productos
            se conservan.
          </p>
        </div>
      )}
      {paso === "dias" && (
        <PasoDias
          cliente={nombreCliente}
          calendario={calendario}
          fechas={fechas}
          favorito={favorito}
          onToggle={toggleFecha}
          onUsarFavorito={usarFavorito}
          onContinuar={() => {
            setProblemas([]);
            setAvisos([]);
            setPaso("catalogo");
          }}
        />
      )}
      {paso === "catalogo" && (
        <PasoCatalogo
          catalogo={catalogo}
          carrito={carrito}
          onCantidad={setCantidad}
          onContinuar={irADistribucion}
        />
      )}
      {paso === "distribucion" && (
        <PasoDistribucion
          catalogo={catalogo}
          fechas={fechas}
          carrito={carrito}
          dist={dist}
          onDist={(id, porFecha) =>
            setDist((prev) => ({ ...prev, [id]: porFecha }))
          }
          onContinuar={() => setPaso("resumen")}
        />
      )}
      {paso === "resumen" && (
        <PasoResumen
          entregas={entregas}
          nombres={nombres}
          precios={precios}
          totales={totales}
          descuentoPorcentaje={catalogo.descuentoPorcentaje}
          minimoPiezas={catalogo.minimoPiezas}
          nota={nota}
          onNota={setNota}
          enviando={enviando}
          error={error}
          problemas={problemas}
          favoritoEstado={favoritoEstado}
          onGuardarFavorito={() => void guardarComoFavorito()}
          onEnviar={() => void enviar()}
        />
      )}
      {paso === "confirmacion" && resultado && (
        <PasoConfirmacion
          resultado={resultado}
          cliente={nombreCliente}
          numeroAtencion={calendario.numeroAtencion}
          onVolver={onSalir}
        />
      )}
      {alerta && (
        <AlertaFlotante mensaje={alerta} onCerrar={() => setAlerta(null)} />
      )}
    </Contenedor>
  );
}

function Contenedor({
  titulo,
  onAtras,
  children,
}: {
  titulo: string;
  onAtras?: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
      <header className="flex items-center justify-between">
        {onAtras ? (
          <button className={BTN_ENLACE} onClick={onAtras}>
            ← Atrás
          </button>
        ) : (
          <span />
        )}
        <span className="text-sm font-semibold">{titulo}</span>
      </header>
      {children}
    </main>
  );
}
