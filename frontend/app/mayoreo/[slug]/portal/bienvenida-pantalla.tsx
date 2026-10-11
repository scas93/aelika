"use client";

import { useEffect, useState } from "react";
import {
  PortalError,
  cerrarSesion,
  fetchCalendario,
  type CalendarioPortal,
  type PortalSesion,
} from "@/lib/portal-api";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_MOTIVO,
  enlaceContacto,
  etiquetaFecha,
  textoLimite,
} from "@/lib/portal-calendario-formato";
import { BTN_PRIMARIO, BTN_SECUNDARIO, CARD, ERROR } from "./estilos";

interface Props {
  slug: string;
  sesion: PortalSesion;
  onCambiarCliente: () => void;
  onCerrada: () => void;
}

// Pantalla provisional: confirma quién entró y (4c) muestra el calendario con el estado de cada día y su hora límite, solo
// para verificarlo. El menú y el diseño final (Crear / Modificar / Ver pedidos) llegan en las siguientes entregas.
export default function BienvenidaPantalla({
  slug,
  sesion,
  onCambiarCliente,
  onCerrada,
}: Props) {
  const [cerrando, setCerrando] = useState(false);
  const [calendario, setCalendario] = useState<CalendarioPortal | null>(null);
  const [errorCalendario, setErrorCalendario] = useState<string | null>(null);
  const clienteId = sesion.cliente?.id;

  useEffect(() => {
    let activo = true;
    fetchCalendario(slug)
      .then((c) => {
        if (activo) setCalendario(c);
      })
      .catch((e) => {
        if (activo)
          setErrorCalendario(
            e instanceof PortalError
              ? e.message
              : "No pudimos cargar el calendario",
          );
      });
    return () => {
      activo = false;
    };
  }, [slug, clienteId]);

  async function cerrar() {
    setCerrando(true);
    try {
      await cerrarSesion(slug);
    } catch {
      // Aunque falle la red, se vuelve al acceso: la cookie la borra el servidor al cerrar o vencer.
    }
    onCerrada();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
      <div className={CARD}>
        <div>
          <p className="text-sm text-mayoreo-ink-soft">
            {sesion.negocio.nombre}
          </p>
          <h1 className="text-xl font-bold">Hola, {sesion.cliente?.nombre}</h1>
          <p className="text-xs text-mayoreo-ink-soft">
            Teléfono terminado en {sesion.telefonoTerminacion}
          </p>
        </div>
        <p className="text-sm text-mayoreo-ink-soft">
          Ya entraste a tu cuenta. Muy pronto podrás crear y consultar tus
          pedidos desde aquí.
        </p>
        {sesion.clientes.length > 1 && (
          <button className={BTN_SECUNDARIO} onClick={onCambiarCliente}>
            Cambiar de cliente
          </button>
        )}
        <button
          className={BTN_PRIMARIO}
          disabled={cerrando}
          onClick={() => void cerrar()}
        >
          {cerrando ? "Cerrando…" : "Cerrar sesión"}
        </button>
      </div>

      <div className={CARD}>
        <div>
          <h2 className="text-base font-bold">Calendario</h2>
          <p className="text-xs text-mayoreo-ink-soft">
            Vista provisional: cada día con su estado y la hora límite. Horas de
            Ciudad de México.
          </p>
        </div>
        {errorCalendario && <p className={ERROR}>{errorCalendario}</p>}
        {!calendario && !errorCalendario && (
          <p className="text-sm text-mayoreo-ink-soft">Cargando calendario…</p>
        )}
        {calendario && (
          <>
            <p className="text-xs text-mayoreo-ink-soft">
              Entrega a las {calendario.horaEntrega} · pedir con{" "}
              {calendario.horasAgregar} h · modificar con{" "}
              {calendario.horasModificar} h · pedidos activos{" "}
              {calendario.pedidosActivos} de {calendario.maximoActivos}
            </p>
            {calendario.semanas.map((semana) => (
              <section
                key={semana.semanaInicio}
                className="flex flex-col gap-1"
              >
                <h3 className="text-sm font-semibold">
                  Semana del {etiquetaFecha(semana.semanaInicio)} al{" "}
                  {etiquetaFecha(semana.semanaFin)}
                  {semana.esActual ? " (en curso)" : ""}
                </h3>
                <p className="text-xs text-mayoreo-ink-soft">
                  {semana.pedido
                    ? `Ya tienes pedido ${semana.pedido.folio}${semana.pedido.pagado ? " (pagado)" : ""}`
                    : semana.puedeCrear
                      ? "Sin pedido: puedes crear uno"
                      : "Sin pedido y sin días disponibles"}
                </p>
                <ul className="flex flex-col divide-y divide-mayoreo-border text-sm">
                  {semana.dias.map((d) => {
                    const limite = textoLimite(d);
                    const contacto =
                      d.estado === "CERRADO"
                        ? enlaceContacto(
                            calendario.numeroAtencion,
                            `Hola, necesito ayuda con mi entrega del ${etiquetaFecha(d.fecha)}`,
                          )
                        : null;
                    return (
                      <li
                        key={d.fecha}
                        className="flex flex-col gap-0.5 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {etiquetaFecha(d.fecha)}
                          </span>
                          <span className="text-xs font-semibold">
                            {ETIQUETA_ESTADO[d.estado]}
                          </span>
                        </div>
                        <div className="text-xs text-mayoreo-ink-soft">
                          {[
                            d.motivo ? ETIQUETA_MOTIVO[d.motivo] : null,
                            d.entrega ? `Entrega: ${d.entrega.estado}` : null,
                            limite,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        {contacto && (
                          <a
                            className="text-xs font-medium underline"
                            href={contacto}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Contactar al negocio
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
