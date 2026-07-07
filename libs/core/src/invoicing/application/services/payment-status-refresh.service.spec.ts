/**
 * Unit tests for `PaymentStatusRefreshService` (#1354).
 *
 * Mocks the repository + an Invoicing adapter that may implement the
 * `PaymentStatusReader` sub-capability. Pins the authoritative-re-read contract
 * (the webhook body is never trusted), write-on-change, and the graceful no-ops
 * for a missing record / an adapter without the capability.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import type { PaymentStatusReader } from '../../domain/ports/capabilities/payment-status-reader.capability';
import type { PaymentStatus, PaymentStatusResult } from '../../domain/types/invoicing.types';
import { PaymentStatusRefreshService } from './payment-status-refresh.service';

const CONNECTION_ID = 'conn-invoicing-1';
const PROVIDER_INVOICE_ID = 'inv-uuid-1';

function makeRecord(paymentStatus: PaymentStatus = 'unpaid'): InvoiceRecord {
  return new InvoiceRecord(
    'rec-1',
    CONNECTION_ID,
    'order-1',
    'infakt',
    'invoice',
    'issued',
    PROVIDER_INVOICE_ID,
    'FV/1',
    'accepted',
    'ksef-1',
    'idem-1',
    null,
    new Date('2026-07-01T10:00:00Z'),
    null,
    new Date('2026-07-01T10:00:00Z'),
    new Date('2026-07-01T10:00:00Z'),
    null,
    null,
    null,
    null,
    false,
    null,
    null,
    null,
    paymentStatus,
  );
}

function baseAdapter(): InvoicingPort {
  return {
    issueInvoice: jest.fn(),
    getInvoice: jest.fn(),
    upsertCustomer: jest.fn(),
    getSupportedDocumentTypes: jest.fn().mockReturnValue(['invoice']),
  } as unknown as InvoicingPort;
}

function readerAdapter(read: PaymentStatusResult): InvoicingPort & PaymentStatusReader {
  return {
    ...baseAdapter(),
    getPaymentStatus: jest.fn().mockResolvedValue(read),
  } as unknown as InvoicingPort & PaymentStatusReader;
}

describe('PaymentStatusRefreshService', () => {
  let service: PaymentStatusRefreshService;
  let repo: jest.Mocked<InvoiceRecordRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findByProviderInvoiceId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      updateOutcome: jest.fn().mockImplementation(() => Promise.resolve(makeRecord('paid'))),
    } as unknown as jest.Mocked<InvoiceRecordRepositoryPort>;

    integrations = {
      getCapabilityAdapter: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new PaymentStatusRefreshService(repo, integrations);
  });

  it('should refresh via an authoritative re-read and persist the changed status', async () => {
    const record = makeRecord('unpaid');
    const adapter = readerAdapter({ paymentStatus: 'paid' });
    integrations.getCapabilityAdapter.mockResolvedValue(adapter);
    repo.findByProviderInvoiceId.mockResolvedValue(record);

    const result = await service.refreshByExternalId(CONNECTION_ID, PROVIDER_INVOICE_ID);

    // The read is authoritative: getPaymentStatus is called with the OL record,
    // never trusting a webhook body.
    expect((adapter as unknown as PaymentStatusReader).getPaymentStatus).toHaveBeenCalledWith(
      record,
    );
    expect(repo.updateOutcome).toHaveBeenCalledWith('rec-1', { paymentStatus: 'paid' });
    expect(result).toEqual({ outcome: 'updated', paymentStatus: 'paid' });
  });

  it('should be a no-op write when the authoritative read matches the stored status', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(readerAdapter({ paymentStatus: 'paid' }));
    repo.findByProviderInvoiceId.mockResolvedValue(makeRecord('paid'));

    const result = await service.refreshByExternalId(CONNECTION_ID, PROVIDER_INVOICE_ID);

    expect(repo.updateOutcome).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'unchanged', paymentStatus: 'paid' });
  });

  it('should no-op when no record matches the provider invoice id', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(readerAdapter({ paymentStatus: 'paid' }));
    repo.findByProviderInvoiceId.mockResolvedValue(null);

    const result = await service.refreshByExternalId(CONNECTION_ID, PROVIDER_INVOICE_ID);

    expect(repo.updateOutcome).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'not-found', paymentStatus: null });
  });

  it('should no-op when the adapter does not implement PaymentStatusReader', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(baseAdapter());

    const result = await service.refreshByExternalId(CONNECTION_ID, PROVIDER_INVOICE_ID);

    expect(repo.findByProviderInvoiceId).not.toHaveBeenCalled();
    expect(repo.updateOutcome).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'unsupported', paymentStatus: null });
  });
});
