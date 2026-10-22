-- Detalle 1:1 de las órdenes de tipo RESERVA (hotel). Aditiva.
CREATE TABLE "detalles_reserva" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pmsProveedor" TEXT NOT NULL,
    "pmsReservaId" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "adultos" INTEGER NOT NULL DEFAULT 0,
    "ninos" INTEGER NOT NULL DEFAULT 0,
    "habitaciones" TEXT,
    "origen" TEXT,
    "moneda" TEXT,
    "idiomaHuesped" TEXT,
    "onlineCheckinUrl" TEXT,

    CONSTRAINT "detalles_reserva_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "detalles_reserva_orderId_key" ON "detalles_reserva"("orderId");
CREATE UNIQUE INDEX "detalles_reserva_tenantId_pmsProveedor_pmsReservaId_key" ON "detalles_reserva"("tenantId", "pmsProveedor", "pmsReservaId");
CREATE INDEX "detalles_reserva_tenantId_checkIn_idx" ON "detalles_reserva"("tenantId", "checkIn");

ALTER TABLE "detalles_reserva" ADD CONSTRAINT "detalles_reserva_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "detalles_reserva" ADD CONSTRAINT "detalles_reserva_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
