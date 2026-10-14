-- CreateTable
CREATE TABLE "sesiones_prueba" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "creadaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renovadaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "venceAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sesiones_prueba_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_prueba_tokenHash_key" ON "sesiones_prueba"("tokenHash");
