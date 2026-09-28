import { IsString, MinLength } from 'class-validator';

// Body compartido por registrar-compra y redimir-premio: solo el token de la
// tarjeta (LoyaltyCard.token, leído del QR personal del cliente). La
// autorización es la de cualquier otra ruta del panel — JWT + rol + tenant
// de la sesión (ver LealtadController), sin credencial extra en el body.
export class TokenTarjetaDto {
  @IsString()
  @MinLength(1)
  token: string;
}
