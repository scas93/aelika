import { ConCanal, SitioWebInput } from '../../scoring/types';

export interface DatosNap {
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
}

export interface ResultadoSitioWebScan {
  // Se pasa directo a DatosEscaneo.sitioWeb del motor de scoring (Fase 1).
  // { tieneCanal: false } cuando el sitio no cargó tras reintentar (regla 3
  // — un sitio roto es una señal legítima de mala presencia web, no un
  // fallo nuestro que deba excluirse).
  sitioWeb: ConCanal<SitioWebInput>;
  nap: DatosNap;
  // Degradaciones y desviaciones declaradas de este escaneo en particular —
  // ver "Manejo de errores" en el prompt de esta integración. Vacío cuando
  // todo salió según lo esperado.
  advertencias: string[];
}
