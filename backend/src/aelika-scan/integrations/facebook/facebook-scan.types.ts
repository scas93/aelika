import { ConCanal, FacebookInput } from '../../scoring/types';

export interface DatosNap {
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
}

export interface ResultadoFacebookScan {
  // Mismo contrato de tres estados que Instagram (ver el prompt de esta
  // integración):
  // - undefined: Apify falló como servicio en la página (regla 4).
  // - { tieneCanal: false }: página no encontrada/eliminada (regla 3).
  // - { tieneCanal: true, ...datos }: caso normal.
  facebook: ConCanal<FacebookInput> | undefined;
  nap: DatosNap;
  advertencias: string[];
}
