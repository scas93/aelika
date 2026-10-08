import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { usarSuite } from './helpers';
import { crearEscenarioB2b } from './escenario-b2b';
import { capturar, volcarLegacy } from './etapa2-dorados';
import { adaptarAlDorado, ajustarDorado } from './etapa2-excepciones';

// Etapa 2 · dorados del módulo B2B.
//
//   ETAPA2_ESCRIBIR_DORADOS=1 npm run test:char -- etapa2-dorados   → regenera el archivo (SOLO contra el código
//                                                                      previo a la Etapa 2; nunca "para arreglar" un fallo)
//   npm run test:char -- etapa2-dorados                             → compara contra el archivo versionado
//
// En modo verificación el escenario se crea por los flujos reales (API); la variante "filas legacy → migración"
// vive en etapa2-migracion.char-spec.ts y compara contra el MISMO archivo.
const ARCHIVO = join(__dirname, '__dorados__', 'etapa2-b2b.json');

describe('Etapa 2 · dorados B2B (flujo por API)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });

  it('la salida HTTP del escenario p1..p6 es idéntica a los dorados', async () => {
    const e = await crearEscenarioB2b(s);
    const consultas = await capturar(s, e);

    if (process.env.ETAPA2_ESCRIBIR_DORADOS === '1') {
      const noOk = Object.entries(consultas).filter(([, v]) => v.status !== 200).map(([k, v]) => `${k}:${v.status}`);
      if (noOk.length) throw new Error(`consultas de dorados que no dieron 200: ${noOk.join(', ')}`);
      const legacy = await volcarLegacy(s.h.prisma);
      mkdirSync(join(__dirname, '__dorados__'), { recursive: true });
      writeFileSync(
        ARCHIVO,
        JSON.stringify(
          {
            _nota: 'Generado contra el código previo a la Etapa 2. No regenerar para arreglar un fallo.',
            tenantId: s.base.tenant.id,
            productoA: s.base.productoA.id,
            productoB: s.base.productoB.id,
            ids: e.ids,
            codigoId: e.codigoId,
            consultas,
            legacy,
          },
          null,
          2,
        ),
      );
      return;
    }

    expect(existsSync(ARCHIVO)).toBe(true);
    const dorados = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
    expect(Object.keys(consultas)).toStrictEqual(Object.keys(dorados.consultas));
    for (const nombre of Object.keys(dorados.consultas)) {
      // Excepciones deliberadas de "estados B2B por entrega": ver etapa2-excepciones.ts (el golden NO se regenera).
      const op = { cancelacionRecalcula: true };
      expect({ nombre, ...adaptarAlDorado(nombre, consultas[nombre], op) }).toStrictEqual({ nombre, ...ajustarDorado(nombre, dorados.consultas[nombre], op) });
    }
  });
});
