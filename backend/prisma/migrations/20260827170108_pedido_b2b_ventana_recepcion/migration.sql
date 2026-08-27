-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "pedidoB2bVentanaAperturaDia" "DiaSemana",
ADD COLUMN     "pedidoB2bVentanaAperturaHora" TEXT,
ADD COLUMN     "pedidoB2bVentanaCierreDia" "DiaSemana",
ADD COLUMN     "pedidoB2bVentanaCierreHora" TEXT;
