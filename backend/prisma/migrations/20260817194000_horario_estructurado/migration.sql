-- Tenant.horarioAtencion moves from free-text to a structured weekly schedule (Json).
-- No production data exists yet (Fase 1, pre-launch), so existing free-text values
-- are cleared rather than parsed. See CLAUDE.md "Convenciones establecidas".
UPDATE "tenants" SET "horarioAtencion" = NULL;
ALTER TABLE "tenants" ALTER COLUMN "horarioAtencion" TYPE JSONB USING "horarioAtencion"::jsonb;
