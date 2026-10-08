import { configurarB2b, seedCodigoDescuento } from './db';
import { Suite } from './helpers';
import { apiRol, bodyB2b, cerrarEntregasB2b, crearAdminB2b, crearPublicoB2b, ItemInput } from './b2b-helpers';

export interface EscenarioB2b {
  ids: Record<'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6', string>;
  codigoId: string;
}

const A = (s: Suite) => s.base.productoA.id;
const B = (s: Suite) => s.base.productoB.id;

/**
 * 6 pedidos B2B por los flujos reales (público, admin, avanzar, marcarPagado, cancelar), con reloj falso.
 * Mínimo de piezas 10. "Hoy" = miércoles 2026-09-30 (CDMX). Semanas (lunes) distintas en pares para
 * poder probar el orden; los empates de semana se comparan sin depender del orden.
 *
 *  p1 · 09-10 público  Abarrotes Uno   sem 09-14  A: LUN 12                  12 pzas $540    → COMPLETADO, PAGADO
 *  p2 · 09-25 público  Bodega Dos      sem 09-28  A: LUN 6 + MIE 6           12 pzas $540    → CONFIRMADO_SURTIENDO
 *  p3 · 09-26 público  Cafetería Tres  sem 09-28  B: MIE 10                  10 pzas $305    → PENDIENTE
 *  p4 · 09-28 público  Deli Cuatro     sem 10-05  A: LUN 10 + B: JUE 5       15 pzas $602.5, PROMO10 (−10%) → $542.25, PENDIENTE
 *  p5 · 09-29 público  Express Cinco   sem 10-05  A: LUN 10                  10 pzas $450    → cancelado
 *  p6 · 09-29 admin    Fonda Seis      sem 10-12  A: MAR 20 (AL_INICIO)      20 pzas $900    → CONFIRMADO_SURTIENDO, PAGADO
 */
export async function crearEscenarioB2b(s: Suite): Promise<EscenarioB2b> {
  const { h, base } = s;
  const codigo = await seedCodigoDescuento(h.prisma, base.tenant.id, { codigo: 'PROMO10', porcentaje: '10.00' });
  const dueno = apiRol(h, base, 'DUENO');
  const en = (iso: string) => jest.setSystemTime(new Date(iso));
  const contacto = (n: string, nombre: string) => ({
    negocioNombre: nombre,
    contactoNombre: nombre.split(' ')[1],
    contactoTelefono: `55110000${n}`,
    contactoCorreo: `${nombre.split(' ')[1].toLowerCase()}@negocio.test`,
  });
  const item = (productId: string, dias: [string, number][]): ItemInput => ({
    productId,
    distribucion: dias.map(([dia, cantidad]) => ({ dia: dia as any, cantidad })),
  });

  en('2026-09-10T15:00:00.000Z');
  const p1 = await crearPublicoB2b(h, base, { ...contacto('01', 'Abarrotes Uno'), semanaInicio: '2026-09-14', items: [item(A(s), [['LUNES', 12]])] });
  await dueno.patch(`/pedidos-b2b/${p1.id}/avanzar`).expect(200);
  await dueno.patch(`/pedidos-b2b/${p1.id}/marcar-pagado`).expect(200);
  await cerrarEntregasB2b(dueno, p1.id); // su única entrega (LUN 12) → Entregada → el pedido queda COMPLETADO

  en('2026-09-25T15:00:00.000Z');
  const p2 = await crearPublicoB2b(h, base, {
    ...contacto('02', 'Bodega Dos'),
    semanaInicio: '2026-09-28',
    items: [item(A(s), [['LUNES', 6], ['MIERCOLES', 6]])],
  });
  await dueno.patch(`/pedidos-b2b/${p2.id}/avanzar`).expect(200);

  en('2026-09-26T15:00:00.000Z');
  const p3 = await crearPublicoB2b(h, base, { ...contacto('03', 'Cafetería Tres'), semanaInicio: '2026-09-28', items: [item(B(s), [['MIERCOLES', 10]])] });

  en('2026-09-28T15:00:00.000Z');
  const p4 = await crearPublicoB2b(h, base, {
    ...contacto('04', 'Deli Cuatro'),
    semanaInicio: '2026-10-05',
    codigoDescuento: 'PROMO10',
    items: [item(A(s), [['LUNES', 10]]), item(B(s), [['JUEVES', 5]])],
  });

  en('2026-09-29T15:00:00.000Z');
  const p5 = await crearPublicoB2b(h, base, { ...contacto('05', 'Express Cinco'), semanaInicio: '2026-10-05', items: [item(A(s), [['LUNES', 10]])] });
  await dueno.patch(`/pedidos-b2b/${p5.id}/cancelar`).expect(200);

  en('2026-09-29T17:00:00.000Z');
  await configurarB2b(h.prisma, base.tenant.id, { modoCobro: 'AL_INICIO' });
  const p6 = await crearAdminB2b(h, base, { ...contacto('06', 'Fonda Seis'), semanaInicio: '2026-10-12', items: [item(A(s), [['MARTES', 20]])] });
  await dueno.patch(`/pedidos-b2b/${p6.id}/marcar-pagado`).expect(200);
  await configurarB2b(h.prisma, base.tenant.id, { modoCobro: 'AL_FINAL' });

  en('2026-09-30T20:00:00.000Z'); // "ahora" para consultar el panel
  h.fakes.reset();
  void bodyB2b;
  return { ids: { p1: p1.id, p2: p2.id, p3: p3.id, p4: p4.id, p5: p5.id, p6: p6.id }, codigoId: codigo.id };
}
