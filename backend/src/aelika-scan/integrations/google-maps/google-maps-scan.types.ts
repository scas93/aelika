import { GoogleMapsInput } from '../../scoring/types';

// Place ID directo si ya se conoce (ej. de un escaneo previo del mismo
// negocio), o nombre + ciudad para resolverlo vía Text Search — igual que el
// prototipo de Bruno.
export type NegocioAResolver =
  { placeId: string } | { nombre: string; ciudad: string };

export interface DatosNap {
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
}

export interface ResultadoGoogleMapsScan {
  // Se pasa directo a DatosEscaneo.googleMaps del motor de scoring (Fase 1),
  // sin transformación adicional.
  googleMaps: GoogleMapsInput;
  nap: DatosNap;
  // Degradaciones y desviaciones declaradas de este escaneo en particular —
  // ver "Manejo de errores" y "Costos" en el prompt de esta integración.
  // Vacío cuando todo salió según lo esperado.
  advertencias: string[];
}
