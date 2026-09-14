// Errores identificables para que el endpoint de la Fase 3 pueda distinguir
// "negocio no encontrado" (nada que hacer, probablemente un error de
// captura del nombre/ciudad) de una falla real de la API de Google (posible
// reintento, o problema de cuota/credenciales) — ver "Manejo de errores" en
// el prompt de esta integración.

export class NegocioNoEncontradoError extends Error {
  constructor(nombre: string, ciudad: string) {
    super(
      `No se encontró ningún negocio para "${nombre}, ${ciudad}" en Google Places`,
    );
    this.name = 'NegocioNoEncontradoError';
  }
}

export class GoogleMapsBusquedaError extends Error {
  constructor(mensaje: string) {
    super(`Google Places (Text Search) falló: ${mensaje}`);
    this.name = 'GoogleMapsBusquedaError';
  }
}

export class GoogleMapsDetallesError extends Error {
  constructor(mensaje: string) {
    super(`Google Places (Place Details) falló: ${mensaje}`);
    this.name = 'GoogleMapsDetallesError';
  }
}
