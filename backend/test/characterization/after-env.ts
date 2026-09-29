import { bloqueados } from './network-guard';

// Falla explícitamente el test que intentó salir a internet, aunque el
// código bajo prueba haya capturado el error.
afterEach(() => {
  const intentos = bloqueados.splice(0);
  if (intentos.length > 0) {
    throw new Error(`Llamada(s) de red saliente NO sustituida(s): ${intentos.join(', ')}`);
  }
});
