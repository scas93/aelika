-- Renames tenants.correoNegocio to stripeContactEmail, preserving existing
-- values (e.g. Banetto's already-configured Stripe contact email). Written
-- by hand as ALTER TABLE ... RENAME COLUMN instead of accepting the
-- DROP + ADD that `prisma migrate dev` would generate by default for a field
-- rename, which would have silently dropped existing data.
ALTER TABLE "tenants" RENAME COLUMN "correoNegocio" TO "stripeContactEmail";
