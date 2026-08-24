import { Controller, Get, Header, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { ExportPaymentsQueryDto } from './dto/export-payments-query.dto';

// No @Roles() — same default-open-to-any-authenticated-role convention as
// OrdersController, this is read-only over data the webhook already writes.
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  findAll(@Query() query: ListPaymentsQueryDto) {
    return this.paymentsService.findAll(query);
  }

  // Must come before any future @Get(':id') — same reason as
  // OrdersController's 'historico'/'historico/export'.
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pagos.csv"')
  export(@Query() query: ExportPaymentsQueryDto) {
    return this.paymentsService.exportCsv(query);
  }
}
