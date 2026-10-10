import { notFound } from "next/navigation";
import PruebaSesionCliente from "./prueba-sesion-cliente";

// Misma variable que lib/api.ts, proxy.ts y next.config.ts.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Entrega 4a de la Fase 4: página de prueba para validar que la sesión del portal sobrevive al navegador interno de
// WhatsApp. Solo existe en staging: la API responde 404 en producción y aquí se convierte en un 404 real.
// Se retira en la 4b.
export const dynamic = "force-dynamic";

export default async function PruebaSesionPage() {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/portal/prueba-sesion/estado`, {
      cache: "no-store",
    });
  } catch {
    // API caída: no se puede saber si está habilitada; se trata como no disponible.
    notFound();
  }
  if (res.status === 404) notFound();
  return <PruebaSesionCliente />;
}
