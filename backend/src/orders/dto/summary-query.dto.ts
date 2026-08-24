import { IsDateString } from 'class-validator';

// Unlike ListOrdersQueryDto, desde/hasta are required here — the frontend
// always sends today's boundary (computed the same way Pedidos already
// does for "Entregados hoy", see PedidosPage.hoyYYYYMMDD/CLAUDE.md) so the
// two screens can never disagree on what "hoy" means.
export class SummaryQueryDto {
  @IsDateString()
  desde!: string;

  @IsDateString()
  hasta!: string;
}
