import { IsEnum, Matches } from 'class-validator';
import { DiaSemana } from '../../../generated/prisma/enums';

const HORA_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Todos los campos son obligatorios dentro de este objeto a propósito — la
// ventana es todo-o-nada (ver normalizarVentanaRecepcion en
// ../ventana-recepcion-b2b.ts). UpdateTenantDto es quien permite que el
// objeto completo sea opcional/null.
export class VentanaRecepcionB2bDto {
  @IsEnum(DiaSemana)
  aperturaDia: DiaSemana;

  @Matches(HORA_PATTERN, { message: 'aperturaHora debe tener formato HH:mm' })
  aperturaHora: string;

  @IsEnum(DiaSemana)
  cierreDia: DiaSemana;

  @Matches(HORA_PATTERN, { message: 'cierreHora debe tener formato HH:mm' })
  cierreHora: string;
}
