import { dividirMensajeTelegram, TELEGRAM_LIMITE } from './telegram-dividir';

function recibo(lineasProducto: number, nota = '') {
  const cuerpo: string[] = [];
  for (let i = 1; i <= lineasProducto; i++) {
    cuerpo.push(`1x Producto ${i} - $10.00 c/u = $10.00`);
    if (nota) cuerpo.push(`   ↳ ${nota} ${i}`);
    cuerpo.push('');
  }
  return [
    'NUEVO PEDIDO #42 - Entredós',
    '🕓 PENDIENTE DE COBRO — se cobra al entregar/recoger',
    '------------------------------',
    'Cliente: Ana',
    '',
    ...cuerpo,
    '------------------------------',
    `TOTAL: $${lineasProducto * 10}.00 MXN`,
    '',
    'Recibido: 21/10/2026 10:00',
  ].join('\n');
}

describe('dividirMensajeTelegram', () => {
  it('un recibo que cabe se devuelve intacto, en una sola parte', () => {
    const t = recibo(5);
    expect(dividirMensajeTelegram(t)).toStrictEqual([t]);
    const justo = 'x'.repeat(TELEGRAM_LIMITE);
    expect(dividirMensajeTelegram(justo)).toStrictEqual([justo]);
  });

  it('uno que excede el límite llega en varias partes, cada una dentro del límite', () => {
    const partes = dividirMensajeTelegram(recibo(200, 'Extra caliente sin hielo'));
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(TELEGRAM_LIMITE);
  });

  it('el folio va en el encabezado de cada parte, numerado (parte i/n)', () => {
    const partes = dividirMensajeTelegram(recibo(200));
    partes.forEach((p, i) => {
      expect(p.startsWith(`NUEVO PEDIDO #42 - Entredós (parte ${i + 1}/${partes.length})\n`)).toBe(true);
    });
  });

  it('no pierde ni reordena líneas: las líneas con contenido, en orden, son exactamente las originales', () => {
    const original = recibo(200, 'Nota con <b>especiales</b> & *x*');
    const partes = dividirMensajeTelegram(original);
    const reconstruido = partes.flatMap((p) => p.split('\n').slice(1)).filter((l) => l !== '');
    const esperado = original.split('\n').slice(1).filter((l) => l !== '');
    expect(reconstruido).toStrictEqual(esperado);
  });

  it('el TOTAL queda al final (última parte), y las notas no se cortan por la mitad', () => {
    const partes = dividirMensajeTelegram(recibo(200, 'Instrucción larga de ejemplo'));
    const ultima = partes[partes.length - 1];
    expect(ultima).toContain('TOTAL: $2000.00 MXN');
    expect(ultima.trimEnd().endsWith('Recibido: 21/10/2026 10:00')).toBe(true);
    for (const p of partes.slice(0, -1)) expect(p).not.toContain('TOTAL:');
    for (const p of partes) for (const l of p.split('\n')) if (l.includes('↳')) expect(l).toMatch(/^ {3}↳ Instrucción larga de ejemplo \d+$/);
  });

  it('una sola línea más larga que el límite también se reparte sin perder texto', () => {
    const larga = 'y'.repeat(TELEGRAM_LIMITE * 2 + 50);
    const partes = dividirMensajeTelegram(`NUEVO PEDIDO #7 - X\n${larga}`);
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(TELEGRAM_LIMITE);
    expect(partes.map((p) => p.split('\n').slice(1).join('')).join('')).toBe(larga);
  });
});
