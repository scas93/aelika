"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { capturar } from "@/lib/analitica";

// Montado solo en el layout de /mayoreo/[slug]: dispara `portal_visto` una vez por carga del portal. No renderiza nada.
export default function AnaliticaPortal() {
  const { slug } = useParams<{ slug: string }>();
  useEffect(() => {
    capturar("portal_visto", { slug });
  }, [slug]);
  return null;
}
