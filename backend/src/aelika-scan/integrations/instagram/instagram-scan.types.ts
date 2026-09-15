import { ConCanal, InstagramInput } from '../../scoring/types';

export interface DatosNap {
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
}

export interface ResultadoInstagramScan {
  // Tres casos distintos (ver el prompt de esta integración):
  // - undefined: Apify falló como servicio tras reintentar — regla 4, la
  //   categoría se omite por completo de este escaneo (quien arma
  //   DatosEscaneo debe omitir la clave `instagram`, no pasar undefined
  //   literal ahí — TypeScript no permite `instagram?: undefined` como
  //   "ausente" y "presente pero undefined" al mismo tiempo sin narrowing
  //   explícito de parte de quien consume esto).
  // - { tieneCanal: false }: cuenta privada o perfil no encontrado — regla 3.
  // - { tieneCanal: true, ...datos }: caso normal.
  instagram: ConCanal<InstagramInput> | undefined;
  nap: DatosNap;
  // Degradaciones y desviaciones declaradas de este escaneo en particular —
  // vacío cuando todo salió según lo esperado.
  advertencias: string[];
}
