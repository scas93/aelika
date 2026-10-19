// El portal ya no fuerza la altura de la pantalla (cada página termina donde termina su contenido). Para que en celular
// el área bajo el contenido siga teniendo el mismo fondo, se le da al body el color del portal solo a ancho de celular
// (max-w-md = 28rem); en pantallas anchas el fondo de la página no cambia.
import AnaliticaPortal from "@/components/analitica-portal";

export default function MayoreoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`@media (max-width: 28rem) { body { background: var(--color-mayoreo-bg); } }`}</style>
      <AnaliticaPortal />
      {children}
    </>
  );
}
