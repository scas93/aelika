// Catálogo de SAT CFDI 4.0, recortado a las claves relevantes para compra de
// mercancías (se excluyen activos fijos I01-I08, deducciones personales
// D01-D10, nómina CN01/CP01, y regímenes de nicho poco probables para
// clientes de Aelika). El SAT actualiza estos catálogos varias veces al
// año — verificar contra el Anexo 20 vigente antes de depender de esto para
// facturación real con clientes.

export interface CatalogoSatItem {
  clave: string;
  descripcion: string;
}

export const REGIMEN_FISCAL: CatalogoSatItem[] = [
  { clave: "601", descripcion: "General de Ley Personas Morales" },
  { clave: "603", descripcion: "Personas Morales con Fines no Lucrativos" },
  { clave: "605", descripcion: "Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { clave: "606", descripcion: "Arrendamiento" },
  { clave: "608", descripcion: "Demás ingresos" },
  { clave: "612", descripcion: "Personas Físicas con Actividades Empresariales y Profesionales" },
  { clave: "616", descripcion: "Sin obligaciones fiscales" },
  { clave: "621", descripcion: "Incorporación Fiscal" },
  { clave: "622", descripcion: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { clave: "625", descripcion: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas" },
  { clave: "626", descripcion: "Régimen Simplificado de Confianza (RESICO)" },
];

export const USO_CFDI: CatalogoSatItem[] = [
  { clave: "G01", descripcion: "Adquisición de mercancías" },
  { clave: "G02", descripcion: "Devoluciones, descuentos o bonificaciones" },
  { clave: "G03", descripcion: "Gastos en general" },
  { clave: "S01", descripcion: "Sin efectos fiscales" },
];

function label(catalogo: CatalogoSatItem[], clave: string | null | undefined): string {
  if (!clave) return "";
  const item = catalogo.find((i) => i.clave === clave);
  return item ? `${item.clave} - ${item.descripcion}` : clave;
}

export function regimenFiscalLabel(clave: string | null | undefined): string {
  return label(REGIMEN_FISCAL, clave);
}

export function usoCfdiLabel(clave: string | null | undefined): string {
  return label(USO_CFDI, clave);
}
