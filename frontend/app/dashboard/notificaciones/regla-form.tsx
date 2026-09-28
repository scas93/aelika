"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  fetchCatalogoVariables,
  type CatalogoVariableDef,
  type CatalogoVariableGrupo,
  type CreateReglaPayload,
  type FiltroCondicion,
  type PlantillaVariable,
  type Regla,
  type ReglaFiltroCampo,
  type ReglaFiltroOperador,
  type ReglaMensajeCategoria,
  type ReglaTriggerOrigenPedido,
  type ReglaTriggerTipo,
} from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";
import ToggleSwitch from "../_components/ToggleSwitch";
import {
  CATEGORIA_LABEL,
  ESTATUS_POR_ORIGEN,
  FILTRO_CAMPO_LABEL,
  FILTRO_OPERADOR_LABEL,
  IDIOMAS_PLANTILLA,
  ORIGEN_PEDIDO_LABEL,
  TRIGGER_LABEL,
} from "./labels";
import { formatFechaHora } from "@/lib/format";

const SECTION_HEADER = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";

const TRIGGERS: ReglaTriggerTipo[] = ["EVENTO_PEDIDO", "ESTADO_CLIENTE", "FECHA_PROGRAMADA", "MANUAL"];
const HORAS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));

const GRUPO_ORDEN: CatalogoVariableGrupo[] = ["CLIENTE", "PEDIDO", "NEGOCIO"];
const GRUPO_LABEL: Record<CatalogoVariableGrupo, string> = {
  CLIENTE: "Cliente",
  PEDIDO: "Pedido",
  NEGOCIO: "Negocio",
};
const CLAVE_VALOR_FIJO = "VALOR_FIJO";

// Sin operador IGUAL para los dos campos de antigüedad — el backend lo
// rechaza al guardar (ver ReglasService.validarFiltro), así que ni se
// ofrece como opción aquí.
function operadoresPara(campo: ReglaFiltroCampo): ReglaFiltroOperador[] {
  return campo === "TOTAL_PEDIDOS" ? ["MAYOR_IGUAL", "MENOR_IGUAL", "IGUAL"] : ["MAYOR_IGUAL", "MENOR_IGUAL"];
}

// Identifica una entrada del catálogo dentro del <select> de una variable —
// "VALOR_FIJO" (sin entrada en el catálogo, texto libre) o "fuente::valor".
function claveDeVariable(v: PlantillaVariable): string {
  return v.fuente === "VALOR_FIJO" ? CLAVE_VALOR_FIJO : `${v.fuente}::${v.valor}`;
}

function buscarEnCatalogo(catalogo: CatalogoVariableDef[], fuente: string, valor: string): CatalogoVariableDef | undefined {
  return catalogo.find((def) => def.fuente === fuente && def.valor === valor);
}

// Espejo de ReglaEnvioService.disponibleParaContexto/ReglasService.
// disponibleParaTrigger (backend) — mismo criterio de restricción, aplicado
// aquí solo para decidir qué deshabilitar en el dropdown, nunca como
// autoridad real (el backend revalida al guardar).
function disponibilidad(
  restriccion: CatalogoVariableDef["restriccion"],
  trigger: ReglaTriggerTipo,
  origen: ReglaTriggerOrigenPedido,
): { ok: boolean; motivo?: string } {
  if (restriccion.tipo === "ninguna") return { ok: true };
  if (trigger !== "EVENTO_PEDIDO") return { ok: false, motivo: restriccion.motivo };
  if (restriccion.tipo === "evento_pedido") return { ok: true };
  return origen === "ORDER" ? { ok: true } : { ok: false, motivo: restriccion.motivo };
}

function renderizarPreview(texto: string, variables: PlantillaVariable[], catalogo: CatalogoVariableDef[]): string {
  if (!texto.trim()) return "";
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, numStr) => {
    const variable = variables.find((v) => v.posicion === Number(numStr));
    if (!variable) return match;
    if (variable.fuente === "VALOR_FIJO") return variable.valor || "(vacío)";
    const def = buscarEnCatalogo(catalogo, variable.fuente, variable.valor);
    return def ? def.ejemplo : match;
  });
}

// Construye un instante absoluto (ISO con offset) a partir de fecha+hora
// LOCALES del navegador — asume que quien arma la Regla lo hace desde una
// computadora en America/Mexico_City, mismo supuesto ya hardcodeado en el
// resto del proyecto (ver backend/src/common/horario.ts) — no hay
// selector de timezone en este formulario.
function fechaHoraALocalIso(dia: string, hora: string): string {
  const [anio, mes, diaNum] = dia.split("-").map(Number);
  return new Date(anio, mes - 1, diaNum, Number(hora), 0, 0, 0).toISOString();
}

function isoAFechaLocal(iso: string): { dia: string; hora: string } {
  const fecha = new Date(iso);
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");
  return { dia: `${yyyy}-${mm}-${dd}`, hora: String(fecha.getHours()).padStart(2, "0") };
}

interface ReglaFormProps {
  initial?: Regla;
  // Fija la categoría según el submódulo de origen (Recontacto = MARKETING,
  // Seguimiento = UTILITY) — no editable en este formulario a propósito: es
  // justo lo que separa los dos submódulos, dejarla editable permitiría que
  // una Regla "se mudara" de categoría sin pasar por la navegación
  // correspondiente. Decisión declarada explícitamente (ver resumen).
  categoriaFija: ReglaMensajeCategoria;
  onSubmit: (payload: CreateReglaPayload) => Promise<void>;
  onCancel: () => void;
}

export default function ReglaForm({ initial, categoriaFija, onSubmit, onCancel }: ReglaFormProps) {
  const triggerConfigInicial = (initial?.triggerConfig ?? {}) as Record<string, unknown>;
  const fechaInicial = esFechaProgramadaConValor(initial)
    ? isoAFechaLocal(String(triggerConfigInicial.fechaHora))
    : { dia: "", hora: "00" };

  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [trigger, setTrigger] = useState<ReglaTriggerTipo>(initial?.trigger ?? "ESTADO_CLIENTE");
  const [origen, setOrigen] = useState<ReglaTriggerOrigenPedido>(
    (triggerConfigInicial.origen as ReglaTriggerOrigenPedido) ?? "ORDER",
  );
  const [estatus, setEstatus] = useState<string>((triggerConfigInicial.estatus as string) ?? "");
  const [fechaDia, setFechaDia] = useState(fechaInicial.dia);
  const [fechaHoraSel, setFechaHoraSel] = useState(fechaInicial.hora);
  const [filtro, setFiltro] = useState<FiltroCondicion[]>(initial?.filtro ?? []);
  const [plantillaNombre, setPlantillaNombre] = useState(initial?.plantillaNombre ?? "");
  const [plantillaIdioma, setPlantillaIdioma] = useState(initial?.plantillaIdioma ?? "es_MX");
  const [plantillaTexto, setPlantillaTexto] = useState(initial?.plantillaTexto ?? "");
  const [variables, setVariables] = useState<PlantillaVariable[]>(initial?.plantillaVariables ?? []);
  const [activa, setActiva] = useState(initial?.activa ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { token } = useSession();
  const [catalogo, setCatalogo] = useState<CatalogoVariableDef[] | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalogoVariables(token)
      .then(setCatalogo)
      .catch((err) => setErrorCatalogo(err instanceof ApiError ? err.message : "No se pudo cargar el catálogo de variables"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Casos borde: cambiar de Trigger (o de origen dentro de EVENTO_PEDIDO)
  // puede volver inválida una variable que ya estaba elegida (ej. una
  // variable "solo menudeo" cuando el origen deja de ser ORDER). Se limpia
  // a Valor fijo vacío en vez de desaparecer en silencio — el usuario ve
  // que necesita llenarla o quitarla. Un solo helper reutilizado por los dos
  // handlers que pueden invalidar una variable (trigger y origen) — no un
  // useEffect reactivo, para no encadenar un segundo render por cada cambio.
  function limpiarVariablesInvalidas(triggerNuevo: ReglaTriggerTipo, origenNuevo: ReglaTriggerOrigenPedido) {
    if (!catalogo) return;
    setVariables((prev) =>
      prev.map((v) => {
        if (v.fuente === "VALOR_FIJO") return v;
        const def = buscarEnCatalogo(catalogo, v.fuente, v.valor);
        if (!def) return v;
        return disponibilidad(def.restriccion, triggerNuevo, origenNuevo).ok ? v : { ...v, fuente: "VALOR_FIJO", valor: "" };
      }),
    );
  }

  function handleTriggerChange(nuevo: ReglaTriggerTipo) {
    setTrigger(nuevo);
    // El Filtro no aplica a EVENTO_PEDIDO (decisión de producto ya tomada).
    if (nuevo === "EVENTO_PEDIDO") {
      setFiltro([]);
    }
    limpiarVariablesInvalidas(nuevo, origen);
  }

  function handleOrigenChange(nuevo: ReglaTriggerOrigenPedido) {
    setOrigen(nuevo);
    setEstatus("");
    limpiarVariablesInvalidas(trigger, nuevo);
  }

  function addCondicion() {
    setFiltro((prev) => [...prev, { campo: "TOTAL_PEDIDOS", operador: "MAYOR_IGUAL", valor: 0 }]);
  }

  function updateCondicion(index: number, patch: Partial<FiltroCondicion>) {
    setFiltro((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c;
        const actualizada = { ...c, ...patch };
        // Si cambió el campo y el operador actual ya no es válido para ese
        // campo (ej. IGUAL sobre un campo de antigüedad), cae al primero
        // válido en vez de mandar una combinación que el backend rechazaría.
        if (patch.campo && !operadoresPara(patch.campo).includes(actualizada.operador)) {
          actualizada.operador = operadoresPara(patch.campo)[0];
        }
        return actualizada;
      }),
    );
  }

  function removeCondicion(index: number) {
    setFiltro((prev) => prev.filter((_, i) => i !== index));
  }

  function addVariable() {
    // Primera entrada del catálogo (Cliente: nombre) como default — siempre
    // disponible, sin importar el trigger.
    const primera = catalogo?.[0];
    setVariables((prev) => [
      ...prev,
      { posicion: prev.length + 1, fuente: primera?.fuente ?? "VALOR_FIJO", valor: primera?.valor ?? "" },
    ]);
  }

  function updateVariableClave(index: number, clave: string) {
    setVariables((prev) =>
      prev.map((v, i) => {
        if (i !== index) return v;
        if (clave === CLAVE_VALOR_FIJO) return { ...v, fuente: "VALOR_FIJO", valor: "" };
        const [fuente, valor] = clave.split("::");
        return { ...v, fuente: fuente as PlantillaVariable["fuente"], valor };
      }),
    );
  }

  function updateVariableTexto(index: number, texto: string) {
    setVariables((prev) => prev.map((v, i) => (i === index ? { ...v, valor: texto } : v)));
  }

  function removeVariable(index: number) {
    // Reindexa posiciones para que sigan siendo 1..N consecutivas — evita
    // huecos que confundirían tanto la vista previa como {{n}} en Botpress.
    setVariables((prev) => prev.filter((_, i) => i !== index).map((v, i) => ({ ...v, posicion: i + 1 })));
  }

  function buildPayload(): CreateReglaPayload {
    const triggerConfig =
      trigger === "EVENTO_PEDIDO"
        ? { origen, estatus }
        : trigger === "FECHA_PROGRAMADA"
          ? { fechaHora: fechaHoraALocalIso(fechaDia, fechaHoraSel) }
          : undefined;

    return {
      nombre: nombre.trim(),
      trigger,
      triggerConfig,
      filtro: trigger === "EVENTO_PEDIDO" ? [] : filtro,
      canal: "WHATSAPP",
      plantillaNombre: plantillaNombre.trim(),
      plantillaIdioma,
      plantillaCategoria: categoriaFija,
      plantillaTexto: plantillaTexto.trim() || undefined,
      plantillaVariables: variables,
      activa,
    };
  }

  const triggerConfigValido =
    trigger === "EVENTO_PEDIDO" ? estatus !== "" : trigger === "FECHA_PROGRAMADA" ? fechaDia !== "" : true;
  const filtroValido = trigger === "EVENTO_PEDIDO" || filtro.every((c) => Number.isFinite(c.valor));
  const variablesValidas = variables.every((v) => {
    if (v.fuente === "VALOR_FIJO") return v.valor.trim() !== "";
    if (!catalogo) return false;
    const def = buscarEnCatalogo(catalogo, v.fuente, v.valor);
    return !!def && disponibilidad(def.restriccion, trigger, origen).ok;
  });
  const canSubmit =
    !submitting &&
    !!catalogo &&
    nombre.trim() !== "" &&
    plantillaNombre.trim() !== "" &&
    triggerConfigValido &&
    filtroValido &&
    variablesValidas;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(buildPayload());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la regla");
    } finally {
      setSubmitting(false);
    }
  }

  const preview = renderizarPreview(plantillaTexto, variables, catalogo ?? []);

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_300px] md:items-start">
      <div className="flex flex-col gap-5">
        {/* --- Nombre + Trigger --- */}
        <Card className="flex flex-col gap-4">
          <h2 className={SECTION_HEADER}>Trigger</h2>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Nombre de la regla
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Recordatorio de pedido listo"
              className="admin-input"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Cuándo se dispara
            <select
              value={trigger}
              onChange={(e) => handleTriggerChange(e.target.value as ReglaTriggerTipo)}
              className="admin-input"
            >
              {TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABEL[t]}
                </option>
              ))}
            </select>
          </label>

          {trigger === "EVENTO_PEDIDO" && (
            <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-admin-control)] border border-admin-border p-3 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                Origen del pedido
                <select
                  value={origen}
                  onChange={(e) => handleOrigenChange(e.target.value as ReglaTriggerOrigenPedido)}
                  className="admin-input"
                >
                  {(Object.keys(ORIGEN_PEDIDO_LABEL) as ReglaTriggerOrigenPedido[]).map((o) => (
                    <option key={o} value={o}>
                      {ORIGEN_PEDIDO_LABEL[o]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                Estatus que dispara
                <select value={estatus} onChange={(e) => setEstatus(e.target.value)} className="admin-input">
                  <option value="">Selecciona...</option>
                  {ESTATUS_POR_ORIGEN[origen].map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {trigger === "FECHA_PROGRAMADA" && (
            <div className="flex flex-col gap-3 rounded-[var(--radius-admin-control)] border border-admin-border p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                  Fecha
                  <input
                    type="date"
                    value={fechaDia}
                    onChange={(e) => setFechaDia(e.target.value)}
                    className="admin-input"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                  Hora (en punto)
                  <select value={fechaHoraSel} onChange={(e) => setFechaHoraSel(e.target.value)} className="admin-input">
                    {HORAS.map((h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {initial?.disparadaEn && (
                <p className="text-sm text-admin-ink-soft">
                  Esta regla ya se disparó el {formatFechaHora(initial.disparadaEn)}. Si cambias la fecha, volverá a
                  activarse para la nueva fecha; si no la tocas, se queda como ya disparada.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* --- Filtro --- */}
        <Card className={`flex flex-col gap-3 ${trigger === "EVENTO_PEDIDO" ? "opacity-50" : ""}`}>
          <div>
            <h2 className={SECTION_HEADER}>Filtro</h2>
            <p className="text-sm text-admin-ink-soft">
              {trigger === "EVENTO_PEDIDO"
                ? "No aplica — el destinatario es siempre el cliente dueño del pedido."
                : "Condiciones combinadas con Y. Sin condiciones, aplica a todos los clientes."}
            </p>
          </div>

          {trigger !== "EVENTO_PEDIDO" && (
            <div className="flex flex-col gap-2">
              {filtro.map((condicion, index) => (
                <div key={index}>
                  {index > 0 && <p className="py-1 text-xs font-bold uppercase text-admin-ink-soft">Y</p>}
                  <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-2">
                    <select
                      value={condicion.campo}
                      onChange={(e) => updateCondicion(index, { campo: e.target.value as ReglaFiltroCampo })}
                      className="admin-input flex-1"
                    >
                      {(Object.keys(FILTRO_CAMPO_LABEL) as ReglaFiltroCampo[]).map((c) => (
                        <option key={c} value={c}>
                          {FILTRO_CAMPO_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={condicion.operador}
                      onChange={(e) => updateCondicion(index, { operador: e.target.value as ReglaFiltroOperador })}
                      className="admin-input flex-1"
                    >
                      {operadoresPara(condicion.campo).map((op) => (
                        <option key={op} value={op}>
                          {FILTRO_OPERADOR_LABEL[op]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={condicion.valor}
                      onChange={(e) => updateCondicion(index, { valor: Number(e.target.value) })}
                      className="admin-input w-24"
                    />
                    <Button type="button" variant="danger" size="sm" onClick={() => removeCondicion(index)}>
                      Quitar
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={addCondicion}>
                + Agregar condición
              </Button>
            </div>
          )}
        </Card>

        {/* --- Canal + Plantilla --- */}
        <Card className="flex flex-col gap-4">
          <h2 className={SECTION_HEADER}>Canal y plantilla</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Canal
              <input value="WhatsApp" disabled className="admin-input opacity-60" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Categoría
              <input value={CATEGORIA_LABEL[categoriaFija]} disabled className="admin-input opacity-60" />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Nombre de la plantilla (Meta)
              <input
                value={plantillaNombre}
                onChange={(e) => setPlantillaNombre(e.target.value)}
                placeholder="pedido_listo_v1"
                className="admin-input"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Idioma
              <select value={plantillaIdioma} onChange={(e) => setPlantillaIdioma(e.target.value)} className="admin-input">
                {IDIOMAS_PLANTILLA.map((idioma) => (
                  <option key={idioma.value} value={idioma.value}>
                    {idioma.label} ({idioma.value})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Texto del cuerpo (solo para tu referencia — no se manda a Botpress)
            <textarea
              value={plantillaTexto}
              onChange={(e) => setPlantillaTexto(e.target.value)}
              placeholder="Hola {{1}}, tu pedido {{2}} ya está listo para recoger."
              rows={4}
              className="admin-input resize-none"
            />
          </label>
        </Card>

        {/* --- Mapeo de variables --- */}
        <Card className="flex flex-col gap-3">
          <div>
            <h2 className={SECTION_HEADER}>Variables de la plantilla</h2>
            <p className="text-sm text-admin-ink-soft">
              Botpress solo soporta variables por posición (<code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>, ...).
            </p>
          </div>

          {errorCatalogo && <p className="text-sm text-red-600">{errorCatalogo}</p>}
          {!catalogo && !errorCatalogo && <p className="text-sm text-admin-ink-soft">Cargando catálogo de variables...</p>}

          {catalogo && (
            <div className="flex flex-col gap-2">
              {variables.map((variable, index) => {
                const def = variable.fuente === "VALOR_FIJO" ? undefined : buscarEnCatalogo(catalogo, variable.fuente, variable.valor);
                const estado = def ? disponibilidad(def.restriccion, trigger, origen) : { ok: true };
                return (
                  <div
                    key={index}
                    className="flex flex-wrap items-center gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-2"
                  >
                    <span className="w-14 shrink-0 text-sm font-bold text-admin-ink">{`{{${variable.posicion}}}`}</span>
                    <select
                      value={claveDeVariable(variable)}
                      onChange={(e) => updateVariableClave(index, e.target.value)}
                      className="admin-input flex-1"
                    >
                      <option value={CLAVE_VALOR_FIJO}>Valor fijo</option>
                      {GRUPO_ORDEN.map((grupo) => {
                        const opciones = catalogo.filter((d) => d.grupo === grupo);
                        if (opciones.length === 0) return null;
                        return (
                          <optgroup key={grupo} label={GRUPO_LABEL[grupo]}>
                            {opciones.map((d) => {
                              const disp = disponibilidad(d.restriccion, trigger, origen);
                              return (
                                <option key={`${d.fuente}::${d.valor}`} value={`${d.fuente}::${d.valor}`} disabled={!disp.ok}>
                                  {d.label} — {d.ejemplo}
                                  {!disp.ok && disp.motivo ? ` (${disp.motivo})` : ""}
                                </option>
                              );
                            })}
                          </optgroup>
                        );
                      })}
                    </select>
                    {variable.fuente === "VALOR_FIJO" ? (
                      <input
                        value={variable.valor}
                        onChange={(e) => updateVariableTexto(index, e.target.value)}
                        placeholder="Panadería Ejemplo"
                        className="admin-input flex-1"
                      />
                    ) : (
                      <input
                        value={def ? `${def.label} — ${def.ejemplo}` : "Variable no reconocida"}
                        disabled
                        className="admin-input flex-1 opacity-60"
                      />
                    )}
                    <Button type="button" variant="danger" size="sm" onClick={() => removeVariable(index)}>
                      Quitar
                    </Button>
                    {!estado.ok && (
                      <p className="w-full text-xs text-red-600">
                        {def?.label}: {estado.motivo} — elige otra variable o quítala.
                      </p>
                    )}
                  </div>
                );
              })}
              <Button type="button" variant="secondary" size="sm" onClick={addVariable}>
                + Agregar variable
              </Button>
            </div>
          )}
        </Card>

        {/* --- Activa + guardar --- */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-admin-ink">Regla activa</p>
              <p className="text-sm text-admin-ink-soft">Una regla inactiva nunca se evalúa ni se dispara.</p>
            </div>
            <ToggleSwitch checked={activa} onChange={() => setActiva((a) => !a)} label={activa ? "Desactivar" : "Activar"} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "Guardando..." : initial ? "Guardar cambios" : "Crear regla"}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </Card>
      </div>

      {/* --- Vista previa en vivo --- */}
      <div className="md:sticky md:top-5">
        <Card className="flex flex-col gap-2">
          <h2 className={SECTION_HEADER}>Vista previa</h2>
          <div className="rounded-[var(--radius-admin-control)] bg-admin-bg p-3">
            {preview ? (
              <p className="whitespace-pre-wrap text-sm text-admin-ink">{preview}</p>
            ) : (
              <p className="text-sm text-admin-ink-soft">Pega el texto del cuerpo para ver la vista previa aquí.</p>
            )}
          </div>
          <p className="text-xs text-admin-ink-soft">
            Los valores de Cliente/Pedido/Negocio son solo el ejemplo del catálogo — el mensaje real usa el dato
            correspondiente de cada cliente/pedido cuando la regla se dispare.
          </p>
        </Card>
      </div>
    </form>
  );
}

function esFechaProgramadaConValor(initial: Regla | undefined): boolean {
  return !!initial && initial.trigger === "FECHA_PROGRAMADA" && !!initial.triggerConfig?.fechaHora;
}
