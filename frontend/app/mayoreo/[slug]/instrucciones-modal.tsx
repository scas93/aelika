"use client";

// max-h-[85vh] + overflow-y-auto en la tarjeta completa, botón sticky
// bottom-0 al final — mismo patrón exacto que checkout-modal.tsx en
// /tienda (ver su comentario junto al botón "Continuar" del paso
// "entrega"): así el botón siempre queda visible dentro del área de
// scroll visible, sin que el usuario tenga que desplazarse manualmente
// para encontrarlo.
const CARD =
  "flex w-full max-w-md flex-col rounded-xl bg-mayoreo-card p-6 shadow-lg max-h-[85vh] overflow-y-auto";
const BTN_PRIMARY =
  "w-full rounded-lg bg-mayoreo-button px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95";

export default function InstruccionesModal({
  minimoPiezas,
  onEntendido,
}: {
  minimoPiezas: number;
  onEntendido: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className={CARD}>
        <h1 className="text-lg font-bold text-mayoreo-ink">Antes de hacer tu pedido</h1>
        <p className="mt-2 text-sm text-mayoreo-ink-soft">
          Aquí puedes armar el pedido de pan de tu negocio para toda la semana, de lunes a domingo.
        </p>

        <h2 className="mt-5 text-sm font-semibold text-mayoreo-ink">Así funciona:</h2>
        <ol className="mt-2 flex flex-col gap-2 text-sm text-mayoreo-ink-soft">
          <li className="flex gap-2">
            <span className="font-semibold text-mayoreo-accent">1.</span>
            Elige los productos y las cantidades totales que necesitas para la semana.
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-mayoreo-accent">2.</span>
            Distribuye esas cantidades entre los días en que quieres recibir tu entrega.
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-mayoreo-accent">3.</span>
            Revisa tu pedido y captura los datos de tu negocio para confirmarlo.
          </li>
        </ol>

        <h2 className="mt-5 text-sm font-semibold text-mayoreo-ink">Algunas cosas importantes:</h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm text-mayoreo-ink-soft">
          <li className="flex gap-2">
            <span className="text-mayoreo-accent">•</span>
            <span>
              Tu pedido debe sumar al menos <strong className="text-mayoreo-ink">{minimoPiezas} piezas</strong> en
              total entre todos los productos.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-mayoreo-accent">•</span>
            Los pedidos deben hacerse con al menos 48 horas de anticipación a tu primera entrega de la semana.
          </li>
          <li className="flex gap-2">
            <span className="text-mayoreo-accent">•</span>
            No se realiza ningún cobro al momento de hacer el pedido. Tu consumo se factura al finalizar la semana,
            según lo efectivamente entregado.
          </li>
          <li className="flex gap-2">
            <span className="text-mayoreo-accent">•</span>
            Si necesitas hacer un ajuste a tu pedido, puedes contactarnos directamente — nuestro equipo lo revisa y
            lo confirma contigo.
          </li>
        </ul>

        <div className="sticky bottom-0 bg-mayoreo-card pb-1 pt-4">
          <button type="button" onClick={onEntendido} className={BTN_PRIMARY}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
