import { IsString, MaxLength, MinLength, Matches } from 'class-validator';

export class AltaClienteLealtadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  // MinLength/MaxLength solo cuentan caracteres — "abcdefg" los pasaba sin
  // ser un teléfono real. normalizarTelefono() descarta todo lo que no sea
  // dígito antes de guardar, así que un valor sin dígitos suficientes
  // normaliza al mismo string (potencialmente "") que otro igual de
  // inválido, fusionando dos clientes distintos en el mismo registro. Exige
  // al menos 7 dígitos reales en el valor crudo, sin importar separadores
  // (espacios, guiones, +52, paréntesis) — no reemplaza normalizarTelefono,
  // solo rechaza antes lo que nunca debió llegar a esa función.
  @Matches(/(?:\D*\d){7,}/, { message: 'telefono debe tener al menos 7 dígitos' })
  telefono: string;
}
