"use client";

import { useState } from "react";
import {
  ApiError,
  type CreateReglaPayload,
  type FiltroCondicion,
  type PlantillaVariable,
  type Regla,
  type ReglaFiltroCampo,
  type ReglaFiltroOperador,
  type ReglaMensajeCategoria,
  type ReglaPlantillaVariableFuente,
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
  ORIGEN_PEDIDO_LABEL,
  TRIGGER_LABEL,
  VARIABLE_FUENTE_LABEL,
} from "./labels";
import { formatFechaHora } from "@/lib/format";

const SECTION_HEADER = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";

const TRIGGERS: ReglaTriggerTipo[] = ["EVENTO_PEDIDO", "ESTADO_CLIENTE", "FECHA_PROGRAMADA", "MANUAL"];
const CATEGORIAS: ReglaMensajeCategoria[] = ["UTILITY", "MARKETING"];
const HORAS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));

// Sin operador IGUAL para los dos campos de antigüedad — el backend lo
// rechaza al guardar (ver ReglasService.validarFiltro), así que ni se
// ofrece como opción aquí.
function operadoresPara(campo: ReglaFiltroCampo): ReglaFiltroOperador[] {
  return campo === "TOTAL_PEDIDOS" ? ["MAYOR_IGUAL", "MENOR_IGUAL", "IGUAL"] : ["MAYOR_IGUAL", "MENOR_IGUAL"];
}

function fuentesPara(trigger: ReglaTriggerTipo): ReglaPlantillaVariableFuente[] {
  return trigger === "EVENTO_PEDIDO" ? ["CAMPO_CLIENTE", "VALOR_FIJO", "CAMPO_PEDIDO"] : ["CAMPO_CLIENTE", "VALOR_FIJO"];
}

// Valor fijo por `fuente` — CAMPO_CLIENTE/CAMPO_PEDIDO solo soportan un
// campo cada uno en esta etapa (ver ReglaEnvioService), así que no hay nada
// que el usuario deba escribir, el selector de fuente ya lo determina.
function valorParaFuente(fuente: ReglaPlantillaVariableFuente): string {
  if (fuente === "CAMPO_CLIENTE") return "nombre";
  if (fuente === "CAMPO_PEDIDO") return "folio";
  return "";
}

// Ejemplo genérico para la vista previa — no hay un Cliente/pedido real en
// este formulario (ver caso de uso del prompt de esta etapa).
function ejemploParaFuente(fuente: ReglaPlantillaVariableFuente, valor: string): string {
  if (fuente === "CAMPO_CLIENTE") return "Juan Pérez";
  if (fuente === "CAMPO_PEDIDO") return "A-1023";
  return valor || "(vacío)";
}

function renderizarPreview(texto: string, variables: PlantillaVariable[]): string {
  if (!texto.trim()) return "";
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, numStr) => {
    const variable = variables.find((v) => v.posicion === Number(numStr));
    return variable ? ejemploParaFuente(variable.fuente, variable.valor) : match;
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
  onSubmit: (payload: CreateReglaPayload) => Promise<void>;
  onCancel: () => void;
}

export default function ReglaForm({ initial, onSubmit, onCancel }: ReglaFormProps) {
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
  const [plantillaCategoria, setPlantillaCategoria] = useState<ReglaMensajeCategoria>(
    initial?.plantillaCategoria ?? "UTILITY",
  );
  const [plantillaTexto, setPlantillaTexto] = useState(initial?.plantillaTexto ?? "");
  const [variables, setVariables] = useState<PlantillaVariable[]>(initial?.plantillaVariables ?? []);
  const [activa, setActiva] = useState(initial?.activa ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTriggerChange(nuevo: ReglaTriggerTipo) {
    setTrigger(nuevo);
    // Casos borde de esta etapa: cambiar de Trigger limpia/adapta lo que ya
    // no aplica, en vez de arrastrar datos de un tipo distinto.
    if (nuevo === "EVENTO_PEDIDO") {
      setFiltro([]);
    } else {
      // Ya no hay pedido de contexto — cualquier variable CAMPO_PEDIDO deja
      // de tener sentido, se convierte a Valor fijo vacío en vez de
      // desaparecer en silencio (el usuario ve que necesita llenarla o
      // quitarla).
      setVariables((prev) =>
        prev.map((v) => (v.fuente === "CAMPO_PEDIDO" ? { ...v, fuente: "VALOR_FIJO", valor: "" } : v)),
      );
    }
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
    setVariables((prev) => [...prev, { posicion: prev.length + 1, fuente: "CAMPO_CLIENTE", valor: "nombre" }]);
  }

  function updateVariable(index: number, patch: Partial<PlantillaVariable>) {
    setVariables((prev) =>
      prev.map((v, i) => {
        if (i !== index) return v;
        const actualizada = { ...v, ...patch };
        if (patch.fuente && patch.fuente !== "VALOR_FIJO") {
          actualizada.valor = valorParaFuente(patch.fuente);
        } else if (patch.fuente === "VALOR_FIJO") {
          actualizada.valor = "";
        }
        return actualizada;
      }),
    );
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
      plantillaIdioma: plantillaIdioma.trim(),
      plantillaCategoria,
      plantillaTexto: plantillaTexto.trim() || undefined,
      plantillaVariables: variables,
      activa,
    };
  }

  const triggerConfigValido =
    trigger === "EVENTO_PEDIDO" ? estatus !== "" : trigger === "FECHA_PROGRAMADA" ? fechaDia !== "" : true;
  const filtroValido = trigger === "EVENTO_PEDIDO" || filtro.every((c) => Number.isFinite(c.valor));
  const variablesValidas = variables.every((v) => v.fuente !== "VALOR_FIJO" || v.valor.trim() !== "");
  const canSubmit =
    !submitting &&
    nombre.trim() !== "" &&
    plantillaNombre.trim() !== "" &&
    plantillaIdioma.trim() !== "" &&
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

  const preview = renderizarPreview(plantillaTexto, variables);

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
                  onChange={(e) => {
                    setOrigen(e.target.value as ReglaTriggerOrigenPedido);
                    setEstatus("");
                  }}
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
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Canal
            <input value="WhatsApp" disabled className="admin-input opacity-60" />
          </label>
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
              <input
                value={plantillaIdioma}
                onChange={(e) => setPlantillaIdioma(e.target.value)}
                placeholder="es_MX"
                className="admin-input"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Categoría
            <select
              value={plantillaCategoria}
              onChange={(e) => setPlantillaCategoria(e.target.value as ReglaMensajeCategoria)}
              className="admin-input"
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIA_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
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
          <div className="flex flex-col gap-2">
            {variables.map((variable, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-2"
              >
                <span className="w-14 shrink-0 text-sm font-bold text-admin-ink">{`{{${variable.posicion}}}`}</span>
                <select
                  value={variable.fuente}
                  onChange={(e) => updateVariable(index, { fuente: e.target.value as ReglaPlantillaVariableFuente })}
                  className="admin-input flex-1"
                >
                  {fuentesPara(trigger).map((f) => (
                    <option key={f} value={f}>
                      {VARIABLE_FUENTE_LABEL[f]}
                    </option>
                  ))}
                </select>
                {variable.fuente === "VALOR_FIJO" ? (
                  <input
                    value={variable.valor}
                    onChange={(e) => updateVariable(index, { valor: e.target.value })}
                    placeholder="Panadería Ejemplo"
                    className="admin-input flex-1"
                  />
                ) : (
                  <input value={valorParaFuente(variable.fuente)} disabled className="admin-input flex-1 opacity-60" />
                )}
                <Button type="button" variant="danger" size="sm" onClick={() => removeVariable(index)}>
                  Quitar
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={addVariable}>
              + Agregar variable
            </Button>
          </div>
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
            Los valores de <em>Campo cliente</em>/<em>Campo pedido</em> son solo un ejemplo genérico — el mensaje real
            usa el dato del cliente/pedido cuando se dispare.
          </p>
        </Card>
      </div>
    </form>
  );
}

function esFechaProgramadaConValor(initial: Regla | undefined): boolean {
  return !!initial && initial.trigger === "FECHA_PROGRAMADA" && !!initial.triggerConfig?.fechaHora;
}
