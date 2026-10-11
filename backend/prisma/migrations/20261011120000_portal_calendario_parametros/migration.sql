-- Fase 4 · 4c: parámetros del calendario del portal del cliente B2B (aditiva; los negocios existentes toman los defaults).
ALTER TABLE "tenants" ADD COLUMN     "portalHoraEntrega" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "portalHorasAgregarDia" INTEGER NOT NULL DEFAULT 36,
ADD COLUMN     "portalHorasModificar" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "portalHorizonteSemanas" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "numeroAtencion" TEXT;
