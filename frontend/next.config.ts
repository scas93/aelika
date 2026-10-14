import type { NextConfig } from "next";

// Mismo backend que consume lib/api.ts y proxy.ts (mismo nombre de variable, mismo default).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // Portal del cliente (Fase 4): el navegador llama a /api-portal/* en el MISMO dominio del storefront y Next lo
  // reenvía a la API. Así la cookie de sesión es de primera parte (sin DNS ni CORS). proxy.ts deja pasar esta ruta.
  async rewrites() {
    return [{ source: "/api-portal/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
