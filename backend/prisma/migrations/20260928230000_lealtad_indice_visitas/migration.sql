-- CreateIndex
CREATE INDEX "loyalty_visits_loyaltyCardId_createdAt_idx" ON "loyalty_visits"("loyaltyCardId", "createdAt");
