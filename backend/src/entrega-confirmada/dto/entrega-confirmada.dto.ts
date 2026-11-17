import { IsString, IsUUID } from 'class-validator';

export class PruebaEntregaConfirmadaDto {
  @IsUUID()
  clienteId: string;

  // La validación definitiva es normalizarCorreo (400 con la dirección recortada).
  @IsString()
  correo: string;
}
