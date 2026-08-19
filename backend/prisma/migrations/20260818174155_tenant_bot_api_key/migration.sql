-- Tenant.botApiKey: bot (Botpress) auth key against the Aelika API. Required
-- and unique, so existing rows need a real value before the NOT NULL/UNIQUE
-- constraints can be added — backfilled here with the same crypto-strength
-- randomness AuthService uses for new tenants (pgcrypto's gen_random_bytes,
-- not the non-cryptographic random()).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "tenants" ADD COLUMN "botApiKey" TEXT;

UPDATE "tenants" SET "botApiKey" = encode(gen_random_bytes(32), 'hex') WHERE "botApiKey" IS NULL;

ALTER TABLE "tenants" ALTER COLUMN "botApiKey" SET NOT NULL;

CREATE UNIQUE INDEX "tenants_botApiKey_key" ON "tenants"("botApiKey");
