import { usarSuite } from './helpers';
import { apiRol } from './b2b-helpers';

// Un negocio de menudeo (B2C) no tiene módulo Adopción: ni el Dueño puede consumirlo.
describe('Adopción · negocio B2C', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2C' } });
  it('el Dueño de un negocio B2C recibe 403', async () => {
    await apiRol(s.h, s.base, 'DUENO').get('/adopcion/clientes').expect(403);
    await apiRol(s.h, s.base, 'DUENO').get('/adopcion/interno').expect(403);
  });
});
