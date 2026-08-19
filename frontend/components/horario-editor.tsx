"use client";

import type { DiaSemana, HorarioDia, HorarioSemana } from "@/lib/api";

const DIAS: { key: DiaSemana; label: string }[] = [
  { key: "lunes", label: "Lunes" },
  { key: "martes", label: "Martes" },
  { key: "miercoles", label: "Miércoles" },
  { key: "jueves", label: "Jueves" },
  { key: "viernes", label: "Viernes" },
  { key: "sabado", label: "Sábado" },
  { key: "domingo", label: "Domingo" },
];

export default function HorarioEditor({
  horario,
  onChange,
}: {
  horario: HorarioSemana;
  onChange: (horario: HorarioSemana) => void;
}) {
  function updateDia(key: DiaSemana, patch: Partial<HorarioDia>) {
    onChange({ ...horario, [key]: { ...horario[key], ...patch } });
  }

  function toggleAbierto(key: DiaSemana, abierto: boolean) {
    updateDia(
      key,
      abierto
        ? { abierto: true, apertura: horario[key].apertura ?? "09:00", cierre: horario[key].cierre ?? "18:00" }
        : { abierto: false, apertura: null, cierre: null },
    );
  }

  function copiarALaSemana() {
    const lunes = horario.lunes;
    const copia = DIAS.reduce((acc, { key }) => {
      acc[key] = { ...lunes };
      return acc;
    }, {} as HorarioSemana);
    onChange(copia);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Horario de atención</span>
      <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
        {DIAS.map(({ key, label }, index) => {
          const dia = horario[key];
          return (
            <div key={key} className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
              <label className="flex w-28 items-center gap-2">
                <input type="checkbox" checked={dia.abierto} onChange={(e) => toggleAbierto(key, e.target.checked)} />
                {label}
              </label>
              <input
                type="time"
                value={dia.apertura ?? ""}
                disabled={!dia.abierto}
                onChange={(e) => updateDia(key, { apertura: e.target.value })}
                className="input py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              />
              <span className="text-black/40 dark:text-white/40">a</span>
              <input
                type="time"
                value={dia.cierre ?? ""}
                disabled={!dia.abierto}
                onChange={(e) => updateDia(key, { cierre: e.target.value })}
                className="input py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              />
              {index === 0 && (
                <button
                  type="button"
                  onClick={copiarALaSemana}
                  className="ml-auto rounded-full border border-black/15 px-3 py-1 text-xs font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Copiar al resto de la semana
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
