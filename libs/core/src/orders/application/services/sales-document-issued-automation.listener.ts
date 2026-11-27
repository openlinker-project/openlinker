/**
 * Sales Document Issued -> Automation Listener (#3554)
 *
 * Binds the `sales-documents` listener port in the orders context: an issued
 * originating invoice or receipt fires the `order.document_issued` automation
 * trigger through `IOrderRecordService`, which owns the order-subject facts.
 * Never throws - the trigger seam is best-effort, as the port requires.
 *
 * @module libs/core/src/orders/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SalesDocumentIssuedEvent,
  SalesDocumentIssuedListenerPort,
} from '@openlinker/core/sales-documents';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';

@Injectable()
export class SalesDocumentIssuedAutomationListener implements SalesDocumentIssuedListenerPort {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService
  ) {}

  async onOriginatingDocumentIssued(event: SalesDocumentIssuedEvent): Promise<void> {
    await this.orderRecords.notifyDocumentIssued(event.internalOrderId, event.issuedAt);
  }
}
