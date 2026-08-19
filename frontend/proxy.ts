import { NextRequest, NextResponse } from "next/server";

// Host que sirve el catálogo público (ej. "pide.aelika.com" en producción,
// "pide.localhost:3000" en desarrollo). Peticiones a ese host se reescriben
// internamente a /tienda/{resto de la ruta} sin exponer /tienda/ en la URL.
const STOREFRONT_HOST = process.env.STOREFRONT_HOST;

export function proxy(request: NextRequest) {
  if (!STOREFRONT_HOST) return NextResponse.next();

  const host = request.headers.get("host") ?? "";
  if (host !== STOREFRONT_HOST) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/tienda${url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
