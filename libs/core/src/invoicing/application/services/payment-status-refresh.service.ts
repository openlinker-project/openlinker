/**
 * Payment Status Refresh Service (#1354)
 *
 * Core application service that refreshes `InvoiceRecord.paymentStatus` for a
 * single document named by a provider payment webhook (e.g. inFakt's
 * `invoice_marked_as_paid`). The webhook is a TRIGGER; the read is
 * AUTHORITATIVE — the service re-reads provider state via the read-only
 * `PaymentStatusReader` ADR-002 sub-capability rather than trusting the webhook
 * body, then write-on-change persists it. Depends ONLY on ports
 * (`InvoiceRecordRepositoryPort` + `IIntegrationsService`), never concrete
 * adapters; nothing from `libs/integrations` is imported and no
 * `faktura`/`paid_date` vocabulary lives here (ADR-026).
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IPaymentStatusRefreshService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';

import type {
  IPaymentStatusRefreshService,
  PaymentStatusRefreshResult,
} from './payment-status-refresh.service.interface';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import { INVOICE_RECORD_REPOSITORY_TOKEN } from '../../invoicing.tokens';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import { isPaymentStatusReader } from '../../domain/ports/capabilities/payment-status-reader.capability';

/** Capability the connection must declare; the reader is a runtime-detected sub-capability. */
const INVOICING_CAPABILITY = 'Invoicing';

@Injectable()
export class PaymentStatusRefreshService implements IPaymentStatusRefreshService {
  private readonly logger = new Logger(PaymentStatusRefreshService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async refreshByExternalId(
    connectionId: string,
    externalInvoiceId: string,
  ): Promise<PaymentStatusRefreshResult> {
    // Resolve the per-connection Invoicing adapter. `PaymentStatusReader` is a
    // runtime sub-capability (ADR-002) — an adapter that cannot read payment
    // status is a clean no-op (warn + `unsupported`), NEVER a throw.
    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      connectionId,
      INVOICING_CAPABILITY,
    );

    if (!isPaymentStatusReader(adapter)) {
      this.logger.warn(
        `Connection ${connectionId} Invoicing adapter does not implement PaymentStatusReader — skipping payment refresh (no-op).`,
      );
      return { outcome: 'unsupported', paymentStatus: null };
    }

    // Locate OL's own projection for the document the webhook named. Missing is a
    // benign no-op: the webhook may reference a document OL never issued.
    const record = await this.repo.findByProviderInvoiceId(connectionId, externalInvoiceId);
    if (!record) {
      this.logger.warn(
        `Payment refresh: no invoice record for provider id ${externalInvoiceId} on connection ${connectionId} (no-op).`,
      );
      return { outcome: 'not-found', paymentStatus: null };
    }

    // Authoritative re-read (a transport/infra failure propagates to the caller
    // for retry — the webhook body is never trusted as the source of truth).
    // `adapter` is narrowed to `PaymentStatusReader` by the guard above.
    const read = await adapter.getPaymentStatus(record);

    if (read.paymentStatus === record.paymentStatus) {
      return { outcome: 'unchanged', paymentStatus: read.paymentStatus };
    }

    await this.repo.updateOutcome(record.id, { paymentStatus: read.paymentStatus });
    this.logger.log(
      `Payment status refreshed (connection=${connectionId}, record=${record.id}): ` +
        `${record.paymentStatus} → ${read.paymentStatus}`,
    );
    return { outcome: 'updated', paymentStatus: read.paymentStatus };
  }
}
