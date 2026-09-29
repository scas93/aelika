#!/usr/bin/env node
// Volcado SANEADO y de SOLO LECTURA de las tablas que necesita el backfill de la Etapa 1.
// Corre DENTRO del contenedor (railway ssh) donde DATABASE_URL apunta al Postgres interno; escribe
// NDJSON (una línea por tabla) a stdout. NO escribe nada en la base: BEGIN READ ONLY + ROLLBACK.
//
// Solo estas tablas (y sus FKs): tenants, clientes, categories, products, puntos_envio, orders,
// order_items, order_item_modifiers, payments. NUNCA users, notificaciones, reglas ni lealtad.
//
// Saneamiento (la migración depende de la NULABILIDAD y de las FK, no de los valores personales):
//  - clientes / orders / payments: nombre, teléfono, correo, dirección, factura y notas enmascarados
//    (se conserva null vs. no-null); ids de Stripe enmascarados.
//  - tenants: botApiKey/botWebhookSecret/botWebhookUrl, stripe* y correos vaciados o reemplazados.
//  - order_item_modifiers.modifierOptionId -> null (no se copian modifier_options; la FK es SetNull).
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { Client } = require('pg');

// GUARDA: el volcado solo debe correr contra staging. Exige VOLCADO_PROYECTO_ESPERADO (nombre del
// proyecto de Railway, p. ej. "merry-compassion") y aborta ANTES de conectarse a la base si el
// contenedor no está en ese proyecto. (El enlace local de `railway` puede apuntar a otro proyecto.)
const esperado = process.env.VOLCADO_PROYECTO_ESPERADO;
const real = process.env.RAILWAY_PROJECT_NAME;
if (!esperado || !real || esperado !== real) {
  console.error(`ABORTO: proyecto esperado "${esperado}" ≠ proyecto real "${real}". No se leyó nada.`);
  process.exit(3);
}
console.error(`guarda OK: proyecto "${real}", entorno "${process.env.RAILWAY_ENVIRONMENT_NAME}", dominio "${process.env.RAILWAY_PUBLIC_DOMAIN ?? '?'}"`);

const TABLAS = ['tenants', 'clientes', 'categories', 'products', 'puntos_envio', 'orders', 'order_items', 'order_item_modifiers', 'payments'];
const enmascara = (v, prefijo, i) => (v === null || v === undefined ? v : `${prefijo}${i}`);

const SANEADORES = {
  tenants: (r, i) => ({
    ...r,
    botApiKey: `sanitized-${r.id}`,
    botWebhookUrl: null,
    botWebhookSecret: null,
    stripeAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeContactEmail: null,
    logoUrl: null,
    ubicacion: enmascara(r.ubicacion, 'Ubicación ', i),
  }),
  clientes: (r, i) => ({ ...r, nombre: `Cliente ${i}`, telefono: String(5500000000 + i), correo: r.correo === null ? null : `cliente${i}@example.test` }),
  orders: (r, i) => ({
    ...r,
    clienteNombre: `Cliente ${i}`,
    clienteTelefono: String(5500000000 + i),
    clienteCorreo: r.clienteCorreo === null ? null : `cliente${i}@example.test`,
    notas: enmascara(r.notas, 'Nota ', i),
    direccionCalle: enmascara(r.direccionCalle, 'Calle ', i),
    direccionNumero: enmascara(r.direccionNumero, '', i),
    direccionColonia: enmascara(r.direccionColonia, 'Colonia ', i),
    direccionReferencias: enmascara(r.direccionReferencias, 'Ref ', i),
    facturaRazonSocial: enmascara(r.facturaRazonSocial, 'Razón social ', i),
    facturaRfc: enmascara(r.facturaRfc, 'RFC', i),
    facturaRegimenFiscal: r.facturaRegimenFiscal,
    facturaUsoCfdi: r.facturaUsoCfdi,
    facturaCodigoPostal: enmascara(r.facturaCodigoPostal, '0', i),
    facturaCorreo: r.facturaCorreo === null ? null : `factura${i}@example.test`,
    stripePaymentIntentId: enmascara(r.stripePaymentIntentId, 'pi_masked_', i),
    stripeRefundId: enmascara(r.stripeRefundId, 're_masked_', i),
  }),
  order_item_modifiers: (r) => ({ ...r, modifierOptionId: null }),
  payments: (r, i) => ({ ...r, stripePaymentIntentId: `pi_masked_pay_${i}` }),
};

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  for (const tabla of TABLAS) {
    const { rows } = await client.query(`SELECT * FROM "${tabla}"`);
    const saneador = SANEADORES[tabla];
    const filas = saneador ? rows.map((r, i) => saneador(r, i + 1)) : rows;
    process.stdout.write(JSON.stringify({ tabla, filas }) + '\n');
    process.stderr.write(`volcado ${tabla}: ${filas.length} filas\n`);
  }
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
