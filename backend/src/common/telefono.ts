// Normaliza un teléfono capturado en formato libre (espacios, guiones,
// paréntesis, lada de país) a una clave canónica para identificar al mismo
// Cliente sin importar cómo se haya escrito en cada pedido — ver
// ClientesService. Regla: se descarta todo lo que no sea dígito y se toman
// los últimos 10 (número nacional significativo en México, sin código de
// país +52 ni el "1" extra que algunos formatos viejos anteponían a
// celulares). "+52 55 1111 2222", "55-1111-2222" y "5511112222" resuelven
// todos a "5511112222". Si quedan menos de 10 dígitos (número corto o mal
// capturado) se usan los que haya, tal cual — no se rellena ni se rechaza
// aquí, la validación de longitud mínima ya ocurrió en el DTO de entrada.
export function normalizarTelefono(telefono: string): string {
  const soloDigitos = telefono.replace(/\D/g, '');
  return soloDigitos.slice(-10);
}
