"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import type {
  CalendarioPortal,
  SemanaCalendarioPortal,
} from "@/lib/portal-api";
import { rangoSemanaCorto } from "@/lib/portal-calendario-formato";
import { rutaBasePortal } from "@/lib/portal-pedidos-formato";
import { BTN_PRIMARIO, BTN_SECUNDARIO, CARD } from "../estilos";
import BotonWhatsApp from "../boton-whatsapp";

interface Props {
  /** Nombre del cliente de la sesión (va en el mensaje precargado de WhatsApp). */
  cliente: string;
  calendario: CalendarioPortal;
  onElegir: (semana: SemanaCalendarioPortal) => void;
}

// Primer paso: una tarjeta por cada semana del horizonte (incluida la en curso). Un pedido = una semana. El estado de cada
// semana lo decide el calendario del servidor (`pedido`, `puedeCrear`); una semana cuyo pedido está cancelado llega con
// `pedido: null`, así que se trata como una semana sin pedido.
export default function PasoSemana({ cliente, calendario, onElegir }: Props) {
  const pathname = usePathname() ?? "";
  const { slug } = useParams<{ slug: string }>() ?? { slug: "" };
  const base = rutaBasePortal(pathname, slug);
  const hayPedido = calendario.semanas.some((s) => s.pedido);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mayoreo-ink-soft">
        Un pedido es para una semana. Elige la semana. Las entregas son a las{" "}
        {calendario.horaEntrega}.
      </p>

      {calendario.semanas.map((semana) => {
        const rango = rangoSemanaCorto(semana.semanaInicio, semana.semanaFin);
        const titulo = (
          <h3 className="text-sm font-semibold">
            Semana {rango}
            {semana.esActual ? " (en curso)" : ""}
          </h3>
        );
        if (semana.pedido) {
          // Mismo criterio que el servidor (semanaModificable): sin pagar y con algún día que se pueda modificar o agregar.
          const modificable =
            !semana.pedido.pagado &&
            semana.dias.some(
              (d) => d.estado === "MODIFICABLE" || d.estado === "AGREGABLE",
            );
          const folio = encodeURIComponent(semana.pedido.folio);
          return (
            <section key={semana.semanaInicio} className={CARD + " gap-3"}>
              {titulo}
              <p className="flex items-start gap-2 text-sm">
                <span className="text-green-700" aria-hidden="true">
                  ✓
                </span>
                <span>Ya tienes un pedido para esta semana</span>
              </p>
              {modificable ? (
                <Link
                  href={`${base}/portal/pedidos/${folio}/modificar?desde=dias`}
                  className={BTN_SECUNDARIO + " block text-center"}
                >
                  Modificar pedido
                </Link>
              ) : (
                <>
                  <p className="text-sm text-mayoreo-ink-soft">
                    Este pedido ya no se puede modificar
                  </p>
                  <Link
                    href={`${base}/portal/pedidos/${folio}`}
                    className={BTN_SECUNDARIO + " block text-center"}
                  >
                    Ver pedido
                  </Link>
                </>
              )}
            </section>
          );
        }
        return (
          <section key={semana.semanaInicio} className={CARD + " gap-3"}>
            {titulo}
            {semana.puedeCrear ? (
              <button className={BTN_PRIMARIO} onClick={() => onElegir(semana)}>
                Hacer pedido
              </button>
            ) : (
              <p className="text-sm text-mayoreo-ink-soft">
                Ya no se puede pedir para esta semana
              </p>
            )}
          </section>
        );
      })}

      {hayPedido && calendario.numeroAtencion !== null && (
        <div className={CARD + " gap-2"}>
          <p className="text-sm text-mayoreo-ink-soft">
            ¿Necesitas pedir o cambiar una entrega que ya no se puede elegir
            aquí? Escríbenos.
          </p>
          <BotonWhatsApp
            numeroAtencion={calendario.numeroAtencion}
            contexto={{ tipo: "general", cliente }}
          />
        </div>
      )}
    </div>
  );
}
