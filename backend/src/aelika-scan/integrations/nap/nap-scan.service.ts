import { Injectable } from '@nestjs/common';
import { NapInput } from '../../scoring/types';
import { FuentesNap, ResultadoNapScan } from './nap-scan.types';

type ResultadoCampo = NapInput['nombreConsistente'];

function normalizarTexto(valor: string): string {
  return valor.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

// "3338333851", "523338333851" y "+52 33 3833 3851" deben considerarse el
// mismo número sin importar prefijo de país — se compara solo el sufijo de
// 10 dígitos (formato de número mexicano sin lada de país).
function normalizarTelefono(valor: string): string {
  return valor.replace(/\D/g, '').slice(-10);
}

/**
 * Comparación pura de Consistencia NAP para Aelika Scan (Fase 2) — sin
 * llamadas externas, opera sobre los bloques `nap` que las otras 4
 * integraciones (Google Maps, Sitio web, Instagram, Facebook) ya obtuvieron.
 * Google Maps y NAP no usan `ConCanal<T>` (ver comentario en
 * `scoring/types.ts`) — esta integración tampoco tiene concepto de "sin
 * canal", solo regla 5 (por campo) y regla 4 (categoría completa, cuando
 * ningún campo tuvo suficientes datos).
 */
@Injectable()
export class NapScanService {
  comparar(fuentes: FuentesNap): ResultadoNapScan {
    const advertencias: string[] = [];

    const nombreConsistente = this.evaluarCampo(
      [
        fuentes.googleMaps?.nombre,
        fuentes.sitioWeb?.nombre,
        fuentes.instagram?.nombre,
        fuentes.facebook?.nombre,
      ],
      normalizarTexto,
    );
    const direccionConsistente = this.evaluarCampo(
      [
        fuentes.googleMaps?.direccion,
        fuentes.sitioWeb?.direccion,
        fuentes.instagram?.direccion,
        fuentes.facebook?.direccion,
      ],
      normalizarTexto,
    );
    const telefonoConsistente = this.evaluarCampo(
      [
        fuentes.googleMaps?.telefono,
        fuentes.sitioWeb?.telefono,
        fuentes.instagram?.telefono,
        fuentes.facebook?.telefono,
      ],
      normalizarTelefono,
    );

    if (!nombreConsistente.disponible) {
      advertencias.push(
        '"Nombre" excluido — menos de 2 fuentes con valor no-nulo, nada que comparar.',
      );
    }
    if (!direccionConsistente.disponible) {
      advertencias.push(
        '"Dirección" excluida — menos de 2 fuentes con valor no-nulo, nada que comparar.',
      );
    }
    if (!telefonoConsistente.disponible) {
      advertencias.push(
        '"Teléfono" excluido — menos de 2 fuentes con valor no-nulo, nada que comparar.',
      );
    }

    if (
      !nombreConsistente.disponible &&
      !direccionConsistente.disponible &&
      !telefonoConsistente.disponible
    ) {
      advertencias.push(
        'Ningún campo tuvo suficientes datos para comparar — categoría NAP excluida de este escaneo (regla 4).',
      );
      return { nap: undefined, advertencias };
    }

    return {
      nap: { nombreConsistente, direccionConsistente, telefonoConsistente },
      advertencias,
    };
  }

  // Regla 5: con menos de 2 valores no-nulos no hay nada que comparar — ni
  // consistente ni inconsistente, se excluye el check.
  private evaluarCampo(
    valores: (string | null | undefined)[],
    normalizar: (valor: string) => string,
  ): ResultadoCampo {
    const noNulos = valores.filter((v): v is string =>
      Boolean(v && v.trim().length > 0),
    );
    if (noNulos.length < 2) {
      return { disponible: false };
    }
    const normalizados = noNulos.map(normalizar);
    const consistente = normalizados.every((v) => v === normalizados[0]);
    return { disponible: true, consistente };
  }
}
