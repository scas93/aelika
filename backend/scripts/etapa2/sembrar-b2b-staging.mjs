#!/usr/bin/env node
// Etapa 0c — siembra de pedidos B2B en STAGING, SOLO por los flujos reales (endpoints públicos y de admin).
// Nunca inserta con SQL: la base se usa únicamente para LEER (transacción READ ONLY) el estado previo
// (idempotencia, plan, guardas de notificaciones). Ver README.md.
//
//   node sembrar-b2b-staging.mjs                 (= --dry-run, solo lectura, no necesita credenciales)
//   node sembrar-b2b-staging.mjs --aplicar
//   node sembrar-b2b-staging.mjs --restaurar [--modo-original=AL_FINAL]
//
// Credenciales (solo del entorno; nunca se imprimen ni se guardan):
//   SEED_DOMINIQUE_EMAIL / SEED_DOMINIQUE_PASSWORD   (rol DUENO: cambia pedidoB2bModoCobro)
//   SEED_BANETTO_EMAIL   / SEED_BANETTO_PASSWORD     (GERENTE o DUENO)
import { Client, guardaProyecto, trunc } from './comun.mjs';

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const RESTAURAR = args.includes('--restaurar');
if (APLICAR && RESTAURAR) { console.error('Usa solo un modo.'); process.exit(1); }
const MODO = RESTAURAR ? 'restaurar' : APLICAR ? 'aplicar' : 'dry-run';
const MODO_ORIGINAL = (args.find((a) => a.startsWith('--modo-original=')) ?? '--modo-original=AL_FINAL').split('=')[1];
if (!['AL_FINAL', 'AL_INICIO'].includes(MODO_ORIGINAL)) { console.error('--modo-original inválido'); process.exit(1); }

const BASE = `http://localhost:${process.env.PORT ?? 3001}`;
const SLUG_B = 'banetto-mayorista';
const SLUG_D = 'dominique-ansel';
const CREDS = {
  [SLUG_B]: { email: process.env.SEED_BANETTO_EMAIL, password: process.env.SEED_BANETTO_PASSWORD },
  [SLUG_D]: { email: process.env.SEED_DOMINIQUE_EMAIL, password: process.env.SEED_DOMINIQUE_PASSWORD },
};

// ---------------------------------------------------------------------------------------------
// Definición de lo que se siembra
// ---------------------------------------------------------------------------------------------
const T = { LUN: 'LUNES', MAR: 'MARTES', MIE: 'MIERCOLES', JUE: 'JUEVES', VIE: 'VIERNES', SAB: 'SABADO', DOM: 'DOMINGO' };
const SEMANA = Object.values(T);
const POCOS = [T.LUN, T.JUE];
const CINCO = [T.LUN, T.MAR, T.MIE, T.JUE, T.VIE];

const FACTURA_FICTICIA = {
  requiereFactura: true,
  facturaRazonSocial: 'Empresa Ficticia Seed SA de CV',
  facturaRfc: 'XAXX010101000',
  facturaRegimenFiscal: '601',
  facturaUsoCfdi: 'G03',
  facturaCodigoPostal: '00000',
  facturaCorreo: 'factura-seed0c@example.com',
};

const CODIGOS = [
  { slug: SLUG_B, codigo: 'SEED0C_BAN10', pct: 10, usosMaximos: null, fechaLimite: null },
  { slug: SLUG_D, codigo: 'SEED0C_DOM10', pct: 10, usosMaximos: null, fechaLimite: null },
  { slug: SLUG_D, codigo: 'SEED0C_AGOTADO', pct: 15, usosMaximos: 1, fechaLimite: null },
  { slug: SLUG_D, codigo: 'SEED0C_VENCIDO', pct: 5, usosMaximos: null, fechaLimite: '2026-01-01' },
];

// piezas: 'alcanza' = mínimo+10 · 'minimo' = el mínimo exacto · 'bajo' = 30% del mínimo
const PEDIDOS = [
  // dominique-ansel — fase A (modo real AL_FINAL)
  { id: 'd01', slug: SLUG_D, flujo: 'admin', fase: 'A', productos: 3, dias: CINCO, piezas: 'alcanza', obj: { estado: 'DESPACHADO', pago: 'PAGADO' }, desc: 'AL_FINAL admin, despachado y pagado' },
  { id: 'd02', slug: SLUG_D, flujo: 'publico', fase: 'A', productos: 2, dias: [T.MAR, T.JUE, T.SAB], piezas: 'alcanza', codigo: 'SEED0C_DOM10', factura: true, obj: { estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE' }, desc: 'público con factura y código' },
  { id: 'd03', slug: SLUG_D, flujo: 'publico', fase: 'A', productos: 1, dias: POCOS, piezas: 'minimo', obj: { estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE' }, desc: 'un solo producto y pocos días' },
  { id: 'd04', slug: SLUG_D, flujo: 'admin', fase: 'A', productos: 2, dias: POCOS, piezas: 'alcanza', codigo: 'SEED0C_AGOTADO', obj: { cancelado: true }, desc: 'cancelado con código agotado (usosMaximos=1)' },
  // dominique-ansel — fase B (modo AL_INICIO, solo admin)
  { id: 'd05', slug: SLUG_D, flujo: 'admin', fase: 'B', productos: 2, dias: [T.LUN, T.MIE, T.VIE, T.DOM], piezas: 'alcanza', obj: { estado: 'CONFIRMADO_SURTIENDO', pago: 'PAGADO' }, desc: 'AL_INICIO pagado y confirmado' },
  { id: 'd06', slug: SLUG_D, flujo: 'admin', fase: 'B', productos: 1, dias: SEMANA, piezas: 'alcanza', obj: { estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE' }, desc: 'AL_INICIO pendiente' },
  // banetto-mayorista (AL_FINAL)
  { id: 'b01', slug: SLUG_B, flujo: 'publico', fase: 'A', productos: 3, dias: SEMANA, piezas: 'alcanza', codigo: 'SEED0C_BAN10', obj: { estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE' }, desc: 'público con código, sin factura' },
  { id: 'b02', slug: SLUG_B, flujo: 'admin', fase: 'A', productos: 2, dias: [T.MAR, T.MIE, T.JUE, T.VIE], piezas: 'alcanza', codigo: 'SEED0C_BAN10', obj: { estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE' }, desc: 'admin con código (sin factura: el flujo admin no la captura)' },
  { id: 'b03', slug: SLUG_B, flujo: 'admin', fase: 'A', productos: 2, dias: [T.LUN, T.MIE, T.VIE], piezas: 'alcanza', obj: { cancelado: true }, desc: 'admin cancelado' },
  { id: 'b04', slug: SLUG_B, flujo: 'admin', fase: 'A', productos: 3, dias: CINCO, piezas: 'alcanza', obj: { estado: 'DESPACHADO', pago: 'PAGADO' }, desc: 'despachado y pagado' },
  { id: 'b05', slug: SLUG_B, flujo: 'admin', fase: 'A', productos: 2, dias: [T.LUN, T.JUE, T.SAB], piezas: 'alcanza', obj: { estado: 'DESPACHADO', pago: 'PENDIENTE' }, desc: 'despachado sin pagar' },
  { id: 'b06', slug: SLUG_B, flujo: 'publico', fase: 'A', productos: 2, dias: POCOS, piezas: 'bajo', obj: { estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE' }, desc: 'bajo el mínimo (queda pendiente)' },
];
// Teléfono ficticio único por variante (10 dígitos, todo ceros): b01..b06 → 0000000001..6, d01..d06 → 0000000101..6.
const telefono = (id) => '00000000' + (id[0] === 'b' ? '0' : '1') + id.slice(2);
const marcador = (id) => `[SEED-0c:${id}]`;

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------
const log = (...a) => console.error(...a);
const msgErr = (r) => `HTTP ${r.status}: ${Array.isArray(r.json?.message) ? r.json.message.join('; ') : (r.json?.message ?? '(sin mensaje)')}`;

async function http(method, ruta, { token, body } = {}) {
  const res = await fetch(BASE + ruta, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: res.status, json, ok: res.ok };
}

async function login(slug) {
  const { email, password } = CREDS[slug];
  if (!email || !password) throw new Error(`Faltan credenciales de ${slug} en el entorno`);
  const r = await http('POST', '/auth/login', { body: { email, password } });
  if (!r.ok || !r.json?.accessToken) throw new Error(`Login de ${slug} falló (${msgErr(r)})`);
  return { token: r.json.accessToken };
}

// ---------------------------------------------------------------------------------------------
// Lecturas (READ ONLY)
// ---------------------------------------------------------------------------------------------
async function leerEstado(db) {
  await db.query('BEGIN READ ONLY');
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const tenants = {};
  for (const slug of [SLUG_B, SLUG_D]) {
    const [t] = await q(`select id, slug, "tipoStorefront" tipo, "pedidoB2bModoCobro" modo, "pedidoB2bMinimoPiezas" minimo, "facturacionModo" fact,
      ("botWebhookUrl" is not null and "botWebhookUrl" <> '') webhook from tenants where slug=$1`, [slug]);
    if (!t) throw new Error(`Tenant ${slug} no existe en esta base`);
    if (t.tipo !== 'RETAIL_B2B') throw new Error(`Tenant ${slug} no es RETAIL_B2B`);
    const [{ n }] = await q(`select count(*)::int n from reglas where "tenantId"=$1 and trigger='EVENTO_PEDIDO' and activa`, [t.id]);
    t.reglasEventoActivas = n;
    tenants[slug] = t;
  }
  const marcados = await q(`select p.id, p."tenantId", p.folio, p.estado, p."estadoPago", p.cancelado, p."modoCobro", p.total::text total,
    substring(p."negocioNombre" from '\\[SEED-0c:([a-z0-9]+)\\]') variante
    from pedidos_b2b p where p."negocioNombre" like '%[SEED-0c:%'`);
  const originales = await q(`select t.slug, count(*)::int n, coalesce(sum(p.total),0)::text suma_total,
    string_agg(p.folio || ':' || p.total::text, ',' order by p.folio::int) folio_total
    from pedidos_b2b p join tenants t on t.id=p."tenantId" where p."negocioNombre" not like '%[SEED-0c:%' group by t.slug order by t.slug`);
  const codigos = await q(`select "tenantId", codigo from pedido_b2b_codigos_descuento where codigo like 'SEED0C\\_%'`);
  await db.query('ROLLBACK');
  return { tenants, marcados, originales, codigos };
}

function piezasDe(spec, minimo) {
  const base = spec.piezas === 'alcanza' ? minimo + 10 : spec.piezas === 'minimo' ? minimo : Math.floor(minimo * 0.3);
  return Math.max(base, spec.productos * spec.dias.length); // al menos 1 pieza por celda
}

function armarItems(catalogo, spec, indice, minimo) {
  const total = piezasDe(spec, minimo);
  const n = spec.productos;
  const elegidos = Array.from({ length: n }, (_, k) => catalogo[(indice * 2 + k) % catalogo.length]);
  const celdas = n * spec.dias.length;
  const base = Math.floor(total / celdas);
  let resto = total - base * celdas;
  const items = elegidos.map((p) => ({
    productId: p.id,
    distribucion: spec.dias.map((dia) => ({ dia, cantidad: base + (resto-- > 0 ? 1 : 0) })),
  }));
  return { items, total };
}

// Próximo paso para llegar al objetivo desde el estado actual (null = ya está; 'imposible' = no se puede).
function siguientePaso(p, obj) {
  if (obj.cancelado) return p.cancelado ? null : 'cancelar';
  if (p.cancelado) return 'imposible';
  if (p.estado !== obj.estado) {
    if (p.modoCobro === 'AL_INICIO' && p.estado === 'PENDIENTE_CONFIRMACION') return obj.pago === 'PAGADO' ? 'marcar-pagado' : 'imposible';
    return 'avanzar';
  }
  if (obj.pago === 'PAGADO' && p.estadoPago !== 'PAGADO') return 'marcar-pagado';
  return null;
}
const objetivoCompleto = (obj) => ({ estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE', ...obj });

// ---------------------------------------------------------------------------------------------
// Modos
// ---------------------------------------------------------------------------------------------
async function infoPublica(slug) {
  const r = await http('GET', `/public/pedidos-b2b/tenants/${slug}`);
  if (!r.ok) throw new Error(`info pública de ${slug}: ${msgErr(r)}`);
  const c = await http('GET', `/public/pedidos-b2b/tenants/${slug}/catalog`);
  if (!c.ok) throw new Error(`catálogo de ${slug}: ${msgErr(c)}`);
  const productos = c.json.categories.flatMap((x) => x.products).sort((a, b) => a.id.localeCompare(b.id));
  return { abierto: r.json.abierto, semana: r.json.semanaDestino.inicio, modo: r.json.pedidoB2bModoCobro, productos };
}

function planear(estado) {
  const filas = [];
  for (const spec of PEDIDOS) {
    const t = estado.tenants[spec.slug];
    const ex = estado.marcados.find((m) => m.tenantId === t.id && m.variante === spec.id);
    let accion;
    if (!ex) accion = 'CREAR + transiciones';
    else {
      const pasos = []; let cur = { ...ex, estadoPago: ex.estadoPago };
      const paso = siguientePaso({ estado: cur.estado, estadoPago: cur.estadoPago, cancelado: cur.cancelado, modoCobro: cur.modoCobro }, objetivoCompleto(spec.obj));
      accion = paso === null ? 'ya existe (completo)' : `ya existe, falta: ${paso}`;
    }
    filas.push({ variante: spec.id, tenant: spec.slug, flujo: spec.flujo, fase: spec.fase, descripcion: spec.desc, accion });
  }
  for (const c of CODIGOS) {
    const t = estado.tenants[c.slug];
    const ex = estado.codigos.some((x) => x.tenantId === t.id && x.codigo === c.codigo);
    filas.push({ variante: c.codigo, tenant: c.slug, flujo: 'admin (CRUD)', fase: '-', descripcion: 'código', accion: ex ? 'ya existe' : 'CREAR' });
  }
  return filas;
}

function revisarNotificaciones(estado) {
  const bloqueos = [];
  for (const [slug, t] of Object.entries(estado.tenants)) {
    log(`[notificaciones] ${slug} (${trunc(t.id)}): reglas EVENTO_PEDIDO activas=${t.reglasEventoActivas}, webhook Botpress configurado=${t.webhook}`);
    if (t.reglasEventoActivas > 0) bloqueos.push(`${slug}: ${t.reglasEventoActivas} regla(s) EVENTO_PEDIDO activa(s)`);
    if (t.webhook) bloqueos.push(`${slug}: webhook de Botpress configurado`);
  }
  return bloqueos;
}

async function modoTenant(auth) {
  const r = await http('GET', '/tenant/me', { token: auth.token });
  if (!r.ok) throw new Error(`GET /tenant/me: ${msgErr(r)}`);
  return r.json.pedidoB2bModoCobro;
}
async function fijarModo(auth, modo) {
  const r = await http('PATCH', '/tenant/me', { token: auth.token, body: { pedidoB2bModoCobro: modo } });
  if (!r.ok) throw new Error(`PATCH /tenant/me: ${msgErr(r)}`);
  const real = await modoTenant(auth);
  if (real !== modo) throw new Error(`Verificación: pedidoB2bModoCobro=${real}, se esperaba ${modo}`);
  return real;
}

async function restaurar() {
  const auth = await login(SLUG_D);
  const antes = await modoTenant(auth);
  log(`[restaurar] dominique-ansel pedidoB2bModoCobro actual=${antes}, objetivo=${MODO_ORIGINAL}`);
  if (antes !== MODO_ORIGINAL) await fijarModo(auth, MODO_ORIGINAL);
  const despues = await modoTenant(auth);
  console.log(JSON.stringify({ modo: 'restaurar', pedidoB2bModoCobro: { antes, despues }, restaurado: despues === MODO_ORIGINAL }));
  if (despues !== MODO_ORIGINAL) process.exit(1);
}

async function aplicar(db, estado) {
  const bloqueos = revisarNotificaciones(estado);
  if (bloqueos.length) {
    log('ABORTO: hay reglas/webhook que podrían enviar mensajes reales al avanzar/cancelar pedidos:');
    bloqueos.forEach((b) => log('  - ' + b));
    log('No se escribió nada. Decide qué hacer y vuelve a correr.');
    process.exit(3);
  }
  const auth = { [SLUG_B]: await login(SLUG_B), [SLUG_D]: await login(SLUG_D) };
  const resultados = [];
  const modoReg = { antes: null, durante: null, despues: null };
  const pub = { [SLUG_B]: await infoPublica(SLUG_B), [SLUG_D]: await infoPublica(SLUG_D) };

  // Modo de dominique: debe ser el original (o AL_INICIO por una corrida interrumpida → se restaura primero).
  let modoD = await modoTenant(auth[SLUG_D]);
  modoReg.antes = modoD;
  if (modoD === 'AL_INICIO' && MODO_ORIGINAL !== 'AL_INICIO') {
    log('[aplicar] dominique-ansel está en AL_INICIO (¿corrida interrumpida?): se restaura antes de empezar');
    await fijarModo(auth[SLUG_D], MODO_ORIGINAL);
    modoD = MODO_ORIGINAL;
  }
  if (modoD !== MODO_ORIGINAL) throw new Error(`pedidoB2bModoCobro de dominique-ansel=${modoD}, esperado ${MODO_ORIGINAL}: abortado`);
  pub[SLUG_D].modo = modoD;
  log(`[modo] dominique-ansel ANTES=${modoReg.antes}`);

  // Códigos (CRUD admin, idempotente por texto).
  for (const c of CODIGOS) {
    const a = auth[c.slug];
    const lista = await http('GET', '/codigos-descuento-b2b', { token: a.token });
    if (!lista.ok) { resultados.push({ id: c.codigo, tenant: c.slug, estado: 'ERROR', motivo: msgErr(lista) }); continue; }
    if (lista.json.some((x) => x.codigo === c.codigo)) { resultados.push({ id: c.codigo, tenant: c.slug, estado: 'ya existía' }); continue; }
    const body = { codigo: c.codigo, descuentoPorcentaje: c.pct, ...(c.usosMaximos ? { usosMaximos: c.usosMaximos } : {}), ...(c.fechaLimite ? { fechaLimite: c.fechaLimite } : {}) };
    const r = await http('POST', '/codigos-descuento-b2b', { token: a.token, body });
    resultados.push(r.ok ? { id: c.codigo, tenant: c.slug, estado: 'creado', usosMaximos: c.usosMaximos, fechaLimite: c.fechaLimite } : { id: c.codigo, tenant: c.slug, estado: 'no creado', motivo: msgErr(r) });
  }

  async function procesar(spec) {
    const idx = PEDIDOS.indexOf(spec);
    const t = estado.tenants[spec.slug];
    const a = auth[spec.slug];
    const info = pub[spec.slug];
    let ped = (await leerMarcado(db, t.id, spec.id));
    const res = { id: spec.id, tenant: spec.slug, flujo: spec.flujo, desc: spec.desc };
    if (!ped) {
      if (spec.flujo === 'publico' && !info.abierto) return { ...res, estado: 'no creado', motivo: 'ventana de recepción cerrada (no se edita la ventana)' };
      if (spec.flujo === 'publico' && spec.fase === 'A' && info.modo !== 'AL_FINAL') return { ...res, estado: 'no creado', motivo: `flujo público requiere AL_FINAL (modo actual ${info.modo})` };
      if (info.productos.length === 0) return { ...res, estado: 'no creado', motivo: 'catálogo sin productos disponibles' };
      const { items, total: piezas } = armarItems(info.productos, spec, idx, t.minimo);
      const body = {
        negocioNombre: `Negocio Ficticio Seed ${spec.id} ${marcador(spec.id)}`,
        contactoNombre: 'Contacto Ficticio Seed',
        contactoTelefono: telefono(spec.id),
        contactoCorreo: `seed0c-${spec.id}@example.com`,
        semanaInicio: info.semana,
        ...(spec.codigo ? { codigoDescuento: spec.codigo } : {}),
        ...(spec.factura ? FACTURA_FICTICIA : {}),
        items,
      };
      const r = spec.flujo === 'admin'
        ? await http('POST', '/pedidos-b2b', { token: a.token, body })
        : await http('POST', `/public/pedidos-b2b/tenants/${spec.slug}/pedidos`, { body });
      if (!r.ok) return { ...res, estado: 'no creado', motivo: msgErr(r) };
      ped = { id: r.json.id, folio: r.json.folio, estado: r.json.estado, estadoPago: r.json.estadoPago, cancelado: r.json.cancelado, modoCobro: r.json.modoCobro, total: String(r.json.total) };
      res.creado = true;
      res.piezas = piezas;
      res.factura = !!r.json.requiereFactura;
      res.codigo = r.json.codigoDescuentoTexto ?? null;
    } else res.creado = false;

    const obj = objetivoCompleto(spec.obj);
    for (let i = 0; i < 6; i++) {
      const paso = siguientePaso(ped, obj);
      if (paso === null) break;
      if (paso === 'imposible') return { ...res, estado: 'incompleto', motivo: 'objetivo inalcanzable desde el estado actual', ...snap(ped) };
      const r = await http('PATCH', `/pedidos-b2b/${ped.id}/${paso}`, { token: a.token });
      if (!r.ok) return { ...res, estado: 'incompleto', motivo: `${paso} → ${msgErr(r)}`, ...snap(ped) };
      ped = { ...ped, estado: r.json.estado, estadoPago: r.json.estadoPago, cancelado: r.json.cancelado };
    }
    return { ...res, estado: res.creado ? 'creado' : 'ya existía', ...snap(ped) };
  }

  // Fase A (modo real) → fase B (AL_INICIO temporal, solo dominique-ansel).
  for (const spec of PEDIDOS.filter((p) => p.fase === 'A')) resultados.push(await procesar(spec));

  const faseB = PEDIDOS.filter((p) => p.fase === 'B');
  const pendientesB = [];
  for (const spec of faseB) if (!(await leerMarcado(db, estado.tenants[spec.slug].id, spec.id))) pendientesB.push(spec);
  let restaurado = false;
  const restaurarSeguro = async () => {
    if (restaurado || modoReg.durante === null) return;
    try { modoReg.despues = await fijarModo(auth[SLUG_D], MODO_ORIGINAL); restaurado = true; log(`[modo] dominique-ansel DESPUÉS=${modoReg.despues}`); }
    catch (e) { log(`ERROR restaurando modo: ${e.message}. Corre: node sembrar-b2b-staging.mjs --restaurar`); }
  };
  const onSig = async () => { await restaurarSeguro(); process.exit(130); };
  process.on('SIGINT', onSig); process.on('SIGTERM', onSig);
  try {
    if (pendientesB.length > 0) {
      modoReg.durante = await fijarModo(auth[SLUG_D], 'AL_INICIO');
      pub[SLUG_D].modo = 'AL_INICIO';
      log(`[modo] dominique-ansel DURANTE=${modoReg.durante} (el storefront público de ese tenant rechaza con 409 mientras dure)`);
    } else log('[modo] fase B: nada que crear, no se cambia el modo');
    for (const spec of faseB) resultados.push(await procesar(spec));
  } finally {
    await restaurarSeguro();
    if (modoReg.durante === null) modoReg.despues = await modoTenant(auth[SLUG_D]);
  }
  console.log(JSON.stringify({ modo: 'aplicar', pedidoB2bModoCobro_dominique: modoReg, resultados }, null, 1));
  if (modoReg.despues !== MODO_ORIGINAL) process.exit(1);
}

const snap = (p) => ({ folio: p.folio, estado_pedido: p.estado, pago: p.estadoPago, cancelado: p.cancelado, total: p.total });

// Lectura puntual (READ ONLY) del pedido sembrado de una variante — para idempotencia/reanudar.
async function leerMarcado(db, tenantId, variante) {
  await db.query('BEGIN READ ONLY');
  const { rows } = await db.query(`select id, folio, estado, "estadoPago", cancelado, "modoCobro", total::text total
    from pedidos_b2b where "tenantId"=$1 and "negocioNombre" like $2`, [tenantId, `%${marcador(variante).replace(/[\\%_]/g, '\\$&')}`]);
  await db.query('ROLLBACK');
  return rows[0];
}

// ---------------------------------------------------------------------------------------------
guardaProyecto();
log(`[modo] ${MODO}`);
if (MODO === 'restaurar') { await restaurar(); process.exit(0); }

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const estado = await leerEstado(db);
  if (MODO === 'dry-run') {
    const bloqueos = revisarNotificaciones(estado);
    console.log(JSON.stringify({
      modo: 'dry-run',
      originales: estado.originales,
      modoCobro: Object.fromEntries(Object.entries(estado.tenants).map(([s, t]) => [s, { modo: t.modo, minimo: t.minimo, facturacion: t.fact }])),
      notificaciones_bloqueo: bloqueos,
      plan: planear(estado),
    }, null, 1));
    if (bloqueos.length) log('--aplicar se negaría a continuar por los bloqueos de notificaciones de arriba.');
  } else {
    await aplicar(db, estado);
  }
} finally {
  await db.end();
}
