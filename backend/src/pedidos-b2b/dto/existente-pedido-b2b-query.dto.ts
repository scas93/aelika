import { IsDateString, IsUUID } from 'class-validator';

export class ExistentePedidoB2bQueryDto {
  @IsUUID()
  clienteId: string;

  // "YYYY-MM-DD", debe ser lunes (se valida en el servicio con el mismo mensaje que al crear).
  @IsDateString()
  semanaInicio: string;
}
