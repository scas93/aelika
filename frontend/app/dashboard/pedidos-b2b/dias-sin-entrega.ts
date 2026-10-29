import { useEffect, useState } from "react";
import { DIAS_SEMANA_PEDIDO_B2B, fetchDiasSinEntrega, type DiaSemanaPedidoB2b } from "@/lib/api";

/** Fecha "YYYY-MM-DD" + n días, a mediodía UTC para que ningún huso recorra el día. */
function sumarDias(iso: string, dias: number): string {
  return new Date(new Date(`${iso.slice(0, 10)}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Días de la semana (lunes = `semanaInicio`) que el negocio marcó sin entrega, con su nota. Si `conEntrega` trae días, esos NO
 * se bloquean: una entrega que ya estaba programada antes de marcar el festivo se puede seguir editando o quitando (el
 * servidor solo rechaza fechas nuevas). El servidor es la fuente de verdad: esto solo evita mandar lo que sabemos que rechaza.
 */
export function diasBloqueadosDeSemana(
  semanaInicio: string,
  diasSinEntrega: ReadonlyMap<string, string | null>,
  conEntrega: ReadonlySet<DiaSemanaPedidoB2b> = new Set(),
): Map<DiaSemanaPedidoB2b, string | null> {
  const bloqueados = new Map<DiaSemanaPedidoB2b, string | null>();
  DIAS_SEMANA_PEDIDO_B2B.forEach(({ value }, i) => {
    const fecha = sumarDias(semanaInicio, i);
    if (diasSinEntrega.has(fecha) && !conEntrega.has(value)) bloqueados.set(value, diasSinEntrega.get(fecha) ?? null);
  });
  return bloqueados;
}

/** Lista de días sin entrega del negocio ("YYYY-MM-DD" → nota). Si no carga, queda vacía: el servidor igual rechaza con 409. */
export function useDiasSinEntrega(token: string, activo: boolean): Map<string, string | null> {
  const [mapa, setMapa] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    fetchDiasSinEntrega(token)
      .then((filas) => {
        if (vigente) setMapa(new Map(filas.map((f) => [f.fecha, f.nota])));
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [token, activo]);
  return mapa;
}
