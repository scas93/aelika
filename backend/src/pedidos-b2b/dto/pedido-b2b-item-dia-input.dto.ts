import { IsEnum, IsInt, Min } from 'class-validator';
import { DiaSemana } from '../../../generated/prisma/enums';

export class PedidoB2bItemDiaInputDto {
  @IsEnum(DiaSemana)
  dia: DiaSemana;

  @IsInt()
  @Min(0)
  cantidad: number;
}
