// Marcas de los medios de pago que se muestran junto a cada opción del checkout. Son SVG en línea (sin peticiones
// extra ni archivos que mantener); `apagado` los pasa a gris para la opción deshabilitada ("próximamente").

const BASE = "h-5 w-auto shrink-0";

function IconoVisa() {
  return (
    <svg viewBox="0 0 32 20" className={BASE} role="img" aria-label="Visa">
      <rect x="0.5" y="0.5" width="31" height="19" rx="3" fill="#fff" stroke="#d4d4d8" />
      <text x="16" y="14" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="9" fontWeight="800" fontStyle="italic" fill="#1434CB">
        VISA
      </text>
    </svg>
  );
}

function IconoMastercard() {
  return (
    <svg viewBox="0 0 32 20" className={BASE} role="img" aria-label="Mastercard">
      <rect x="0.5" y="0.5" width="31" height="19" rx="3" fill="#fff" stroke="#d4d4d8" />
      <circle cx="12.5" cy="10" r="5.5" fill="#EB001B" />
      <circle cx="19.5" cy="10" r="5.5" fill="#F79E1B" />
      <path d="M16 5.6a5.5 5.5 0 0 1 0 8.8 5.5 5.5 0 0 1 0-8.8z" fill="#FF5F00" />
    </svg>
  );
}

function IconoAmex() {
  return (
    <svg viewBox="0 0 32 20" className={BASE} role="img" aria-label="American Express">
      <rect width="32" height="20" rx="3" fill="#016FD0" />
      <text x="16" y="13.2" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="7.5" fontWeight="800" fill="#fff">
        AMEX
      </text>
    </svg>
  );
}

function IconoSpei() {
  return (
    <svg viewBox="0 0 40 20" className={BASE} role="img" aria-label="SPEI">
      <rect x="0.5" y="0.5" width="39" height="19" rx="3" fill="#fff" stroke="#d4d4d8" />
      <text x="20" y="13.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="9.5" fontWeight="800" letterSpacing="0.5" fill="#2B2B6B">
        SPEI
      </text>
      <rect x="9" y="15" width="22" height="1.5" rx="0.75" fill="#E0562A" />
    </svg>
  );
}

export function IconosTarjeta({ apagado = false }: { apagado?: boolean }) {
  return (
    <span className={`ml-auto flex items-center gap-1 ${apagado ? "opacity-50 grayscale" : ""}`}>
      <IconoVisa />
      <IconoMastercard />
      <IconoAmex />
    </span>
  );
}

export function IconoTransferencia({ apagado = false }: { apagado?: boolean }) {
  return (
    <span className={`ml-auto flex items-center ${apagado ? "opacity-50 grayscale" : ""}`}>
      <IconoSpei />
    </span>
  );
}
