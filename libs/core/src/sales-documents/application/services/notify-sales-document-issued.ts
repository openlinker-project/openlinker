/**
 * Notify Sales Document Issued (#3554)
 *
 * The one place an issuer (`InvoiceService`, `FiscalRegistrationService`) tells
 * the {@link SalesDocumentIssuedListenerPort} that an order's originating
 * document was issued. Resolved through `ModuleRef` with `strict: false`, so the
 * issuer takes no static dependency on whichever context binds the listener; an
 * absent binding is a silent skip and any failure is logged and swallowed - the
 * document is already issued, and nothing downstream may undo that.
 *
 * @module libs/core/src/sales-documents/application/services
 */
import type { ModuleRef } from '@nestjs/core';
import type { Logger } from '@openlinker/shared/logging';
import type {
  SalesDocumentIssuedEvent,
  SalesDocumentIssuedListenerPort,
} from '../../domain/ports/sales-document-issued-listener.port';
import { SALES_DOCUMENT_ISSUED_LISTENER_TOKEN } from '../../sales-documents.tokens';

export async function notifySalesDocumentIssued(
  moduleRef: ModuleRef | undefined,
  event: SalesDocumentIssuedEvent,
  logger: Pick<Logger, 'warn'>
): Promise<void> {
  if (!moduleRef) return;
  let listener: SalesDocumentIssuedListenerPort;
  try {
    listener = moduleRef.get<SalesDocumentIssuedListenerPort>(
      SALES_DOCUMENT_ISSUED_LISTENER_TOKEN,
      { strict: false }
    );
  } catch {
    // Not bound in this process (a host without the orders context): nothing listens.
    return;
  }
  try {
    await listener.onOriginatingDocumentIssued(event);
  } catch (error) {
    logger.warn(
      `Could not report the issued ${event.documentKind} of order ${event.internalOrderId}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
}
