-- Aditiva: módulos opcionales apagados por negocio (vacío = todo encendido).
ALTER TABLE "tenants" ADD COLUMN "modulosDesactivados" TEXT[] DEFAULT ARRAY[]::TEXT[];
