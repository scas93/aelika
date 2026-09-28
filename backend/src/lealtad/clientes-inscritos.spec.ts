import { ClienteInscrito, ordenarInscritos } from './clientes-inscritos';

function fila(p: Partial<ClienteInscrito> & { id: string }): ClienteInscrito {
  return {
    nombre: p.id,
    telefono: '3311112222',
    contador: 1,
    estado: 'EN_PROGRESO',
    ultimoSelloAt: null,
    inscritoAt: new Date('2026-01-01T12:00:00Z'),
    ...p,
  };
}

const d = (iso: string) => new Date(iso);

describe('ordenarInscritos', () => {
  it('premio pendiente arriba aunque su último sello sea más viejo que el de otro cliente sin premio', () => {
    const orden = ordenarInscritos([
      fila({ id: 'reciente-sin-premio', ultimoSelloAt: d('2026-09-28T15:00:00Z') }),
      fila({ id: 'premio-viejo', estado: 'PREMIO_DISPONIBLE', contador: 10, ultimoSelloAt: d('2026-03-01T15:00:00Z') }),
    ]).map((f) => f.id);
    expect(orden).toEqual(['premio-viejo', 'reciente-sin-premio']);
  });

  it('aplica el orden completo: premio → con sellos por fecha → sin sellos por inscripción → nombre', () => {
    const orden = ordenarInscritos([
      fila({ id: 'sin-sellos-viejo', contador: 0, inscritoAt: d('2026-02-01T00:00:00Z') }),
      fila({ id: 'sellos-viejo', ultimoSelloAt: d('2026-05-01T00:00:00Z') }),
      fila({ id: 'premio-reciente', estado: 'PREMIO_DISPONIBLE', contador: 10, ultimoSelloAt: d('2026-09-20T00:00:00Z') }),
      fila({ id: 'sin-sellos-reciente', contador: 0, inscritoAt: d('2026-09-01T00:00:00Z') }),
      fila({ id: 'sellos-reciente', ultimoSelloAt: d('2026-09-27T00:00:00Z') }),
      fila({ id: 'premio-viejo', estado: 'PREMIO_DISPONIBLE', contador: 10, ultimoSelloAt: d('2026-04-01T00:00:00Z') }),
    ]).map((f) => f.id);
    expect(orden).toEqual([
      'premio-reciente',
      'premio-viejo',
      'sellos-reciente',
      'sellos-viejo',
      'sin-sellos-reciente',
      'sin-sellos-viejo',
    ]);
  });

  it('los clientes sin sellos van al final, aunque se hayan inscrito después del último sello de otros', () => {
    const orden = ordenarInscritos([
      fila({ id: 'sin-sellos-nuevo', contador: 0, inscritoAt: d('2026-09-28T18:00:00Z') }),
      fila({ id: 'con-sello-viejo', ultimoSelloAt: d('2025-08-14T18:00:00Z') }),
    ]).map((f) => f.id);
    expect(orden).toEqual(['con-sello-viejo', 'sin-sellos-nuevo']);
  });

  it('desempata por nombre alfabético en español (acentos/mayúsculas no importan) y luego por id', () => {
    const misma = d('2026-09-28T15:00:00Z');
    const orden = ordenarInscritos([
      fila({ id: 'z', nombre: 'Zoe', ultimoSelloAt: misma }),
      fila({ id: 'b', nombre: 'Ángel', ultimoSelloAt: misma }),
      fila({ id: 'c', nombre: 'beto', ultimoSelloAt: misma }),
      fila({ id: 'a', nombre: 'Ángel', ultimoSelloAt: misma }),
    ]).map((f) => f.id);
    expect(orden).toEqual(['a', 'b', 'c', 'z']);
  });

  it('no muta el arreglo recibido', () => {
    const entrada = [fila({ id: 'b', contador: 0 }), fila({ id: 'a', ultimoSelloAt: d('2026-09-01T00:00:00Z') })];
    ordenarInscritos(entrada);
    expect(entrada.map((f) => f.id)).toEqual(['b', 'a']);
  });
});
