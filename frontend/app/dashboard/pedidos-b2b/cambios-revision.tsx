import type { PedidoB2bCambiosRespuesta } from "@/lib/api";
import { contenidoSeccion } from "./cambios-vista";

// «Cambios desde la última revisión»: debajo del aviso «Modificado por el cliente». Solo informativa; el equipo ve el mismo
// cambio marcado en su lugar dentro de la lista de entregas.
export default function CambiosRevision({ respuesta }: { respuesta: PedidoB2bCambiosRespuesta | null }) {
  const contenido = contenidoSeccion(respuesta);
  if (!contenido) return null;
  return (
    <section aria-label="Cambios desde la última revisión" className="flex flex-col gap-1.5">
      <span className="text-sm font-bold text-admin-ink">Cambios desde la última revisión</span>
      {contenido.sinDetalle || contenido.textos.length === 1 ? (
        <p className="text-xs text-admin-ink-soft">{contenido.textos[0]}</p>
      ) : (
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-admin-ink">
          {contenido.textos.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
