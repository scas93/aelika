import { NapInput } from '../../scoring/types';

export interface DatosNapFuente {
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
}

// Las 4 fuentes son opcionales — puede que alguna se haya excluido por
// regla 4 en su propia integración, o que el negocio no tenga ese canal.
export interface FuentesNap {
  googleMaps?: DatosNapFuente;
  sitioWeb?: DatosNapFuente;
  instagram?: DatosNapFuente;
  facebook?: DatosNapFuente;
}

export interface ResultadoNapScan {
  // undefined = regla 4: ningún campo (nombre/dirección/teléfono) tuvo al
  // menos 2 valores no-nulos entre las fuentes evaluadas — no tiene sentido
  // reportar la categoría.
  nap: NapInput | undefined;
  advertencias: string[];
}
