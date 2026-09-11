import { IsDateString } from 'class-validator';

// Mismo shape que orders/dto/summary-query.dto.ts — el frontend manda el
// mismo rango "hoy" (rangoHoyISO()) que ya usa para /orders/summary/daily,
// para que ambas gráficas del dashboard usen exactamente la misma ventana
// de 10 días sin poder desincronizarse.
export class SummaryQueryDto {
  @IsDateString()
  desde!: string;

  @IsDateString()
  hasta!: string;
}
