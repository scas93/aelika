"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import CantidadInput from "@/components/cantidad-input";
import {
  PortalError,
  fetchCatalogo,
  fetchEstadoModificar,
  modificarPedido,
  problemasDeError,
  type EstadoModificarPortal,
  type ProblemaFechaPortal,
} from "@/lib/portal-api";
import {
  ETIQUETA_MOTIVO,
  etiquetaFecha,
  etiquetaMomento,
} from "@/lib/portal-calendario-formato";
import {
  borradorInicial,
  entregasAEnviar,
  entregasVigentes,
  lineasEfectivas,
  totalesEstimados,
  type Borrador,
} from "@/lib/portal-modificar-modelo";
import BotonWhatsApp from "../../../boton-whatsapp";
import {
  AVISO,
  BTN_ENLACE,
  BTN_PRIMARIO,
  BTN_SECUNDARIO,
  CARD,
  ERROR,
  dinero,
} from "../../../estilos";
import { useSesionPortal } from "../../usar-sesion-portal";

interface ProductoCatalogo {
  id: string;
  nombre: string;
  precio: number;
}

// Modificar un pedido (4f): una tarjeta por día. Lo editable lo decide el servidor (calendario de la 4c); el resto se
// muestra de solo lectura con el botón de WhatsApp. El servidor revalida todo al guardar.
export default function ModificarPedidoPage() {
  const { slug, folio } = useParams<{ slug: string; folio: string }>();
  const folioReal = decodeURIComponent(folio);
  const { sesion, numeroAtencion, base, router } = useSesionPortal(slug);

  const [estado, setEstado] = useState<EstadoModificarPortal | null>(null);
  const [catalogo, setCatalogo] = useState<ProductoCatalogo[]>([]);
  const [original, setOriginal] = useState<Borrador>({});
  const [borrador, setBorrador] = useState<Borrador>({});
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<ProblemaFechaPortal[]>([]);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState<string | null>(null);

  const leer = useCallback(
    () =>
      Promise.all([
        fetchEstadoModificar(slug, folioReal),
        fetchCatalogo(slug).catch(() => null),
      ]),
    [slug, folioReal],
  );

  const aplicar = useCallback(
    (
      e: EstadoModificarPortal,
      c: Awaited<ReturnType<typeof fetchCatalogo>> | null,
      aviso: string | null,
    ) => {
      setEstado(e);
      setCatalogo(c ? c.categories.flatMap((x) => x.products) : []);
      const b = borradorInicial(e.dias);
      setOriginal(b);
      setBorrador(structuredClone(b));
      setAbiertos(new Set());
      setNota(e.notaCliente ?? "");
      setConfirmando(false);
      setError(aviso);
    },
    [],
  );

  const manejarErrorCarga = useCallback(
    (err: unknown) => {
      if (err instanceof PortalError && err.status === 401)
        return router.replace(base);
      if (err instanceof PortalError && err.status === 404)
        return setNoEncontrado(true);
      setError(
        err instanceof PortalError
          ? err.message
          : "Algo salió mal. Intenta de nuevo",
      );
    },
    [base, router],
  );

  useEffect(() => {
    if (!sesion) return;
    let activo = true;
    leer()
      .then(([e, c]) => {
        if (activo) aplicar(e, c, null);
      })
      .catch((err: unknown) => activo && manejarErrorCarga(err));
    return () => {
      activo = false;
    };
  }, [sesion, leer, aplicar, manejarErrorCarga]);

  // Vuelve a leer el pedido y el calendario (después de un 409) conservando el mensaje que explica qué pasó.
  async function recargar(aviso: string) {
    try {
      const [e, c] = await leer();
      aplicar(e, c, aviso);
    } catch (err) {
      manejarErrorCarga(err);
    }
  }

  const editables = useMemo(() => {
    const s = new Set<string>();
    if (!estado || estado.bloqueo) return s;
    for (const d of estado.dias)
      if (
        (d.estado === "MODIFICABLE" && d.entrega) ||
        (d.estado === "AGREGABLE" && !d.entrega)
      )
        s.add(d.fecha);
    return s;
  }, [estado]);

  const nombres = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of estado?.dias ?? [])
      for (const p of d.entrega?.productos ?? []) m.set(p.productId, p.nombre);
    for (const p of catalogo) m.set(p.id, p.nombre);
    return m;
  }, [estado, catalogo]);

  const precioDe = useCallback(
    (id: string) => {
      const vivo = catalogo.find((p) => p.id === id);
      if (vivo) return vivo.precio;
      for (const d of estado?.dias ?? [])
        for (const p of d.entrega?.productos ?? [])
          if (p.productId === id) return p.precioUnitario;
      return 0;
    },
    [catalogo, estado],
  );

  if (noEncontrado) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
        <Link href={`${base}/portal/pedidos`} className={BTN_ENLACE}>
          ← Mis pedidos
        </Link>
        <div className={CARD}>
          <p className="text-sm text-mayoreo-ink-soft">
            No encontramos este pedido.
          </p>
        </div>
      </main>
    );
  }

  const cliente = sesion?.cliente?.nombre ?? "";

  if (guardado) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
        <div className={CARD}>
          <h1 className="text-xl font-bold">Cambios guardados</h1>
          <p className="text-sm">{guardado}</p>
          <Link
            href={`${base}/portal/pedidos/${encodeURIComponent(folioReal)}`}
            className={BTN_PRIMARIO + " block text-center"}
          >
            Ver mi pedido
          </Link>
        </div>
      </main>
    );
  }

  const totales = totalesEstimados(
    borrador,
    precioDe,
    estado?.descuentoPorcentaje ?? 0,
  );
  const cambios = estado ? entregasAEnviar(original, borrador, editables) : [];
  const notaCambio = !!estado && nota.trim() !== (estado.notaCliente ?? "");
  const sinEntregas = entregasVigentes(borrador) === 0;
  const bajoMinimo =
    !!estado && estado.minimoPiezas > 0 && totales.piezas < estado.minimoPiezas;

  function cambiarLinea(fecha: string, productId: string, cantidad: number) {
    setBorrador((b) => ({
      ...b,
      [fecha]: {
        ...b[fecha],
        lineas: { ...b[fecha].lineas, [productId]: cantidad },
      },
    }));
  }
  function alternarQuitar(fecha: string) {
    setBorrador((b) => ({
      ...b,
      [fecha]: { ...b[fecha], quitado: !b[fecha].quitado },
    }));
  }
  function agregarProducto(fecha: string, productId: string) {
    if (!productId) return;
    cambiarLinea(fecha, productId, 1);
  }

  async function guardar() {
    if (!estado) return;
    setGuardando(true);
    setError(null);
    setProblemas([]);
    try {
      const r = await modificarPedido(slug, folioReal, {
        version: estado.version,
        entregas: cambios,
        ...(notaCambio ? { notaCliente: nota.trim() || null } : {}),
      });
      const estadoNuevo = r.pedido.estado.codigo;
      setGuardado(
        !r.cambio
          ? "No había nada que cambiar."
          : estadoNuevo === "PENDIENTE_CONFIRMACION"
            ? "Tu pedido quedó por confirmar. Te avisaremos cuando lo confirmemos otra vez."
            : "Tus cambios quedaron guardados. El negocio verá que modificaste el pedido.",
      );
    } catch (e) {
      if (e instanceof PortalError && e.status === 401)
        return router.replace(base);
      const mensaje =
        e instanceof PortalError
          ? e.message
          : "Algo salió mal. Intenta de nuevo";
      setProblemas(problemasDeError(e));
      // El pedido cambió o el calendario avanzó: se vuelve a leer para mostrar lo vigente.
      if (e instanceof PortalError && e.status === 409) {
        const ps = problemasDeError(e);
        await recargar(mensaje);
        setProblemas(ps);
      } else {
        setError(mensaje);
        setConfirmando(false);
      }
    } finally {
      setGuardando(false);
    }
  }

  const bloqueado = !!estado?.bloqueo;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 pb-8 font-mayoreo text-mayoreo-ink">
      <header className="flex flex-col gap-1">
        <Link
          href={`${base}/portal/pedidos/${encodeURIComponent(folioReal)}`}
          className={BTN_ENLACE}
        >
          ← Volver al pedido
        </Link>
        <h1 className="text-xl font-bold">Modificar pedido {folioReal}</h1>
        {estado && (
          <p className="text-sm text-mayoreo-ink-soft">
            Semana del {etiquetaFecha(estado.semanaInicio)} al{" "}
            {etiquetaFecha(estado.semanaFin)}
          </p>
        )}
      </header>

      {error && <p className={ERROR}>{error}</p>}
      {problemas.length > 0 && (
        <ul className={ERROR + " list-disc pl-6"}>
          {problemas.map((p) => (
            <li key={p.fecha + p.motivo}>{p.mensaje}</li>
          ))}
        </ul>
      )}
      {!estado && !error && <p className="text-mayoreo-ink-soft">Cargando…</p>}

      {estado && bloqueado && (
        <div className={CARD}>
          <p className="text-sm">{estado.bloqueo!.mensaje}</p>
          <BotonWhatsApp
            numeroAtencion={numeroAtencion ?? estado.numeroAtencion}
            contexto={{
              tipo: "pedido",
              cliente,
              folios: [estado.folio],
            }}
          />
        </div>
      )}

      {estado && !bloqueado && (
        <>
          <div className={AVISO}>
            Puedes cambiar un día hasta {estado.horasModificar} horas antes de
            la entrega, y agregar un día hasta {estado.horasAgregar} horas
            antes. Al guardar, todos los productos del pedido se recalculan con
            los precios de hoy, incluidos los de entregas ya cerradas.
            {estado.estadoPedido === "CONFIRMADO_SURTIENDO" &&
              " Tu pedido está confirmado: al guardar volverá a Por confirmar hasta que lo confirmemos otra vez."}
          </div>

          {estado.dias.map((d) => {
            const dia = borrador[d.fecha];
            if (!dia) return null;
            const editable = editables.has(d.fecha);
            const lineas = lineasEfectivas(dia);
            const mostrarLineas = editable ? { ...dia.lineas } : lineas;
            const abierto = abiertos.has(d.fecha) || dia.existia;
            const sinProductos =
              editable &&
              dia.existia &&
              !dia.quitado &&
              Object.keys(lineas).length === 0;
            return (
              <section
                key={d.fecha}
                className="flex flex-col gap-2 rounded-xl border border-mayoreo-border bg-mayoreo-card p-4 shadow-sm"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold capitalize">
                    {etiquetaFecha(d.fecha)}
                  </h2>
                  <span className="text-xs text-mayoreo-ink-soft">
                    {d.estado === "MODIFICABLE" && d.limiteAt
                      ? `Hasta ${etiquetaMomento(d.limiteAt)}`
                      : d.estado === "AGREGABLE" && d.limiteAt
                        ? `Agregar hasta ${etiquetaMomento(d.limiteAt)}`
                        : d.motivo
                          ? ETIQUETA_MOTIVO[d.motivo]
                          : ""}
                  </span>
                </div>

                {dia.quitado ? (
                  <p className="text-sm text-mayoreo-ink-soft">
                    Esta entrega se quitará al guardar.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {Object.entries(mostrarLineas).map(([id, cantidad]) => (
                      <li
                        key={id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span>{nombres.get(id) ?? "Producto"}</span>
                        {editable ? (
                          <CantidadInput
                            value={cantidad}
                            onChange={(v) =>
                              cambiarLinea(d.fecha, id, v === "" ? 0 : v)
                            }
                            aria-label={`${nombres.get(id) ?? "Producto"} el ${etiquetaFecha(d.fecha)}`}
                            className="mayoreo-input w-24 text-center"
                          />
                        ) : (
                          <span>{cantidad}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {sinProductos && (
                  <p className="text-xs text-mayoreo-ink-soft">
                    Sin productos: esta entrega se quitará al guardar.
                  </p>
                )}

                {editable && !dia.quitado && abierto && (
                  <select
                    className="mayoreo-input"
                    value=""
                    onChange={(e) => agregarProducto(d.fecha, e.target.value)}
                    aria-label={`Agregar producto el ${etiquetaFecha(d.fecha)}`}
                  >
                    <option value="">Agregar producto…</option>
                    {catalogo
                      .filter((p) => !((dia.lineas[p.id] ?? 0) > 0))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre} — {dinero(p.precio)}
                        </option>
                      ))}
                  </select>
                )}

                {editable && dia.existia && (
                  <button
                    className={BTN_ENLACE + " self-start"}
                    onClick={() => alternarQuitar(d.fecha)}
                  >
                    {dia.quitado ? "Deshacer" : "Quitar esta entrega"}
                  </button>
                )}
                {editable && !dia.existia && !abierto && (
                  <button
                    className={BTN_SECUNDARIO}
                    onClick={() => setAbiertos((s) => new Set(s).add(d.fecha))}
                  >
                    Agregar este día
                  </button>
                )}

                {!editable && d.entrega && (
                  <BotonWhatsApp
                    compacto
                    numeroAtencion={numeroAtencion ?? estado.numeroAtencion}
                    contexto={{ tipo: "dia", cliente, fecha: d.fecha }}
                  />
                )}
              </section>
            );
          })}

          <section className={CARD + " gap-2"}>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Nota para el negocio</span>
              <textarea
                className="mayoreo-input min-h-20"
                maxLength={500}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            </label>
            <div className="flex justify-between text-sm">
              <span>Subtotal estimado</span>
              <span>{dinero(totales.subtotal)}</span>
            </div>
            {totales.descuento > 0 && (
              <div className="flex justify-between text-sm">
                <span>Descuento ({estado.descuentoPorcentaje}%)</span>
                <span>−{dinero(totales.descuento)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold">
              <span>Total estimado</span>
              <span>{dinero(totales.total)}</span>
            </div>
            <p className="text-xs text-mayoreo-ink-soft">
              El total final lo calcula el negocio al guardar.
            </p>
          </section>

          {sinEntregas && (
            <div className={ERROR}>
              Un pedido debe conservar al menos una entrega. Si quieres
              cancelarlo, contáctanos.
              <div className="mt-2">
                <BotonWhatsApp
                  numeroAtencion={numeroAtencion ?? estado.numeroAtencion}
                  contexto={{
                    tipo: "pedido",
                    cliente,
                    folios: [estado.folio],
                  }}
                />
              </div>
            </div>
          )}
          {bajoMinimo && (
            <p className={ERROR}>
              El pedido necesita al menos {estado.minimoPiezas} piezas (llevas{" "}
              {totales.piezas}).
            </p>
          )}

          {!confirmando ? (
            <button
              className={BTN_PRIMARIO}
              disabled={
                (cambios.length === 0 && !notaCambio) ||
                sinEntregas ||
                bajoMinimo
              }
              onClick={() => setConfirmando(true)}
            >
              Guardar cambios
            </button>
          ) : (
            <div className={CARD}>
              <p className="text-sm font-semibold">
                ¿Guardar{" "}
                {cambios.length > 0
                  ? `${cambios.length} cambio(s) de entrega`
                  : "la nota"}
                {cambios.length > 0 && notaCambio ? " y la nota" : ""}?
              </p>
              <button
                className={BTN_PRIMARIO}
                disabled={guardando}
                onClick={() => void guardar()}
              >
                {guardando ? "Guardando…" : "Confirmar y guardar"}
              </button>
              <button
                className={BTN_SECUNDARIO}
                disabled={guardando}
                onClick={() => setConfirmando(false)}
              >
                Seguir editando
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
