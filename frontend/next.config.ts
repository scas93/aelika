import type { NextConfig } from "next";

// Mismo backend que consume lib/api.ts y proxy.ts (mismo nombre de variable, mismo default).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Mientras Aelika no sea autoservicio (los negocios los da de alta el equipo), la portada lleva directo al login y el alta vive en una
// ruta no enlazada (/registrar-negocio). Para reabrir el registro: NEXT_PUBLIC_REGISTRO_ABIERTO=true (se evalúa al compilar).
const REGISTRO_ABIERTO = process.env.NEXT_PUBLIC_REGISTRO_ABIERTO === "true";
const STOREFRONT_HOST = process.env.STOREFRONT_HOST;

const nextConfig: NextConfig = {
  // Solo desarrollo: el indicador de Next (esquina inferior izquierda por defecto) tapaba el bloque del usuario al fondo de la barra
  // lateral, y en otra esquina tapa el pie del panel del pedido. Los errores de compilación/ejecución siguen mostrándose.
  devIndicators: false,
  // Portal del cliente (Fase 4): el navegador llama a /api-portal/* en el MISMO dominio del storefront y Next lo
  // reenvía a la API. Así la cookie de sesión es de primera parte (sin DNS ni CORS). proxy.ts deja pasar esta ruta.
  async redirects() {
    if (REGISTRO_ABIERTO) return [];
    return [
      // En el host del catálogo público "/" no es la portada de Aelika: lo maneja proxy.ts.
      {
        source: "/",
        ...(STOREFRONT_HOST ? { missing: [{ type: "host" as const, value: STOREFRONT_HOST }] } : {}),
        destination: "/login",
        permanent: false,
      },
      { source: "/register", destination: "/login", permanent: false },
    ];
  },
  async rewrites() {
    return [{ source: "/api-portal/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
