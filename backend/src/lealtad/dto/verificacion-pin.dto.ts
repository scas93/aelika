import { IsString, Matches } from 'class-validator';

// Base compartida por los 2 endpoints protegidos por PIN (registrar compra,
// redimir premio) — el PIN viaja en el body de cada llamada, sin sesión ni
// caché de pantalla (se verifica en cada request, ver LealtadPinGuard).
export class VerificacionPinDto {
  @IsString()
  token: string;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'El PIN debe ser numérico, de 4 a 6 dígitos' })
  pin: string;
}
