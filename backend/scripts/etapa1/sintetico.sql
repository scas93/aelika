-- Datos SINTÉTICOS para probar el backfill de la Etapa 1 sobre una base en el estado PREVIO a la
-- migración (columnas viejas de orders pobladas, sin detalles_b2c). Cubre cada variante: RECOGER y
-- DOMICILIO; con y sin puntoEnvioId; dirección completa y parcial; notasDescuento con y sin valor;
-- cada horaRecogidaTipo; factura; TARJETA con ids Stripe. Ids fijos para poder comparar.
INSERT INTO "tenants" ("id","slug","nombre","botApiKey","updatedAt") VALUES
  ('t-sint-1','sintetico-1','Sintético 1','key-sint-1', now()),
  ('t-sint-2','sintetico-2','Sintético 2','key-sint-2', now());

INSERT INTO "categories" ("id","tenantId","nombre","updatedAt") VALUES ('cat-1','t-sint-1','Bebidas', now());
INSERT INTO "products" ("id","tenantId","categoryId","nombre","precio","updatedAt") VALUES ('prod-1','t-sint-1','cat-1','Café','45.00', now());

INSERT INTO "clientes" ("id","tenantId","canal","telefono","nombre","primerPedidoAt","ultimoPedidoAt","totalPedidos","updatedAt") VALUES
  ('cli-1','t-sint-1','B2C','5500000001','Ana', now(), now(), 8, now()),
  ('cli-2','t-sint-2','B2C','5500000002','Beto', now(), now(), 1, now());

INSERT INTO "puntos_envio" ("id","tenantId","nombre","direccion","pedidoMinimo","updatedAt") VALUES
  ('pe-1','t-sint-1','Zona Centro','Av. Reforma 100','50.00', now()),
  ('pe-2','t-sint-1','Zona Norte','Norte 1', NULL, now());

-- 1 RECOGER, LO_ANTES_POSIBLE, sin notasDescuento (defaults)
INSERT INTO "orders" ("id","tenantId","folio","clienteNombre","clienteTelefono","clienteId","total","updatedAt") VALUES
  ('o-1','t-sint-1','1','Ana','5500000001','cli-1','45.00', now());
-- 2 RECOGER, HORA_ESPECIFICA con hora, notasDescuento con valor
INSERT INTO "orders" ("id","tenantId","folio","clienteNombre","clienteTelefono","clienteId","horaRecogidaTipo","horaRecogida","notasDescuento","descuentoTotal","total","updatedAt") VALUES
  ('o-2','t-sint-1','2','Ana','5500000001','cli-1','HORA_ESPECIFICA','10:30','Café x2 (-10%)','9.00','81.00', now());
-- 3 DOMICILIO con punto y dirección COMPLETA (con referencias)
INSERT INTO "orders" ("id","tenantId","folio","clienteNombre","clienteTelefono","clienteId","metodoEntrega","puntoEnvioId","direccionCalle","direccionNumero","direccionColonia","direccionReferencias","total","updatedAt") VALUES
  ('o-3','t-sint-1','3','Ana','5500000001','cli-1','DOMICILIO','pe-1','Calle Roble','12-B','Del Valle','Portón azul','90.00', now());
-- 4 DOMICILIO con punto y dirección PARCIAL (sin referencias)
INSERT INTO "orders" ("id","tenantId","folio","clienteNombre","clienteTelefono","clienteId","metodoEntrega","puntoEnvioId","direccionCalle","direccionNumero","direccionColonia","total","updatedAt") VALUES
  ('o-4','t-sint-1','4','Ana','5500000001','cli-1','DOMICILIO','pe-2','Calle Pino','7','Centro','45.00', now());
-- 5 DOMICILIO SIN puntoEnvioId y dirección parcial (solo calle) — dato histórico posible antes de validaciones
INSERT INTO "orders" ("id","tenantId","folio","clienteNombre","clienteTelefono","clienteId","metodoEntrega","direccionCalle","total","updatedAt") VALUES
  ('o-5','t-sint-1','5','Ana','5500000001','cli-1','DOMICILIO','Calle Sola','45.00', now());
-- 6 TARJETA + factura + notas + notasDescuento + correo
INSERT INTO "orders" ("id","tenantId","folio","clienteNombre","clienteTelefono","clienteCorreo","clienteId","notas","metodoPago","estadoPago","stripePaymentIntentId","requiereFactura","facturaRazonSocial","facturaRfc","facturaRegimenFiscal","facturaUsoCfdi","facturaCodigoPostal","facturaCorreo","notasDescuento","descuentoTotal","total","updatedAt") VALUES
  ('o-6','t-sint-1','6','Ana','5500000001','ana@test.com','cli-1','Sin hielo','TARJETA','PAGADO','pi_sint_6', true,'Cafés SA','CCE010101AB1','601','G03','06000','fac@test.com','Combo Café + Concha x1','15.50','60.00', now());
-- 7 estados avanzados y REEMBOLSADO
INSERT INTO "orders" ("id","tenantId","folio","clienteNombre","clienteTelefono","clienteId","estadoPedido","metodoPago","estadoPago","stripePaymentIntentId","stripeRefundId","total","updatedAt") VALUES
  ('o-7','t-sint-1','7','Ana','5500000001','cli-1','DESPACHADO','TARJETA','REEMBOLSADO','pi_sint_7','re_sint_7','45.00', now());
-- 8 otro tenant, DOMICILIO sin notasDescuento
INSERT INTO "orders" ("id","tenantId","folio","clienteNombre","clienteTelefono","clienteId","metodoEntrega","direccionCalle","direccionNumero","direccionColonia","total","updatedAt") VALUES
  ('o-8','t-sint-2','1','Beto','5500000002','cli-2','DOMICILIO','Calle X','1','Col Z','30.50', now());

INSERT INTO "order_items" ("id","tenantId","orderId","productId","nombreProducto","precioUnitario","cantidad") VALUES
  ('oi-1','t-sint-1','o-1','prod-1','Café','45.00',1),
  ('oi-3','t-sint-1','o-3','prod-1','Café','45.00',2);
