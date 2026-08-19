import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-semibold">Aelika</h1>
      <p className="max-w-md text-sm text-black/60 dark:text-white/60">
        Recibe pedidos de pickup sin pagar comisión. Configura tu catálogo y
        empieza a vender en minutos.
      </p>
      <div className="flex gap-4">
        <Link
          href="/register"
          className="rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 dark:bg-white dark:text-black"
        >
          Crear mi negocio
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Iniciar sesión
        </Link>
      </div>
    </main>
  );
}
