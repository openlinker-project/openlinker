/**
 * ConnectionDiagnosticsResponseDto - unit tests (#3179)
 *
 * `fromDomain`'s merge rule: a document registration is real connection
 * activity even when its `sync_jobs` row has left this read's own recent-job
 * window, so `lastSucceededAt` / `lastFailedAt` take the most recent
 * observation ACROSS sync jobs, fiscal registrations and invoices - never
 * sync jobs alone.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { FiscalRegistrationRecord } from '@openlinker/core/fiscalization';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import { ConnectionDiagnosticsResponseDto } from './connection-diagnostics-response.dto';

const CONNECTION = new Connection(
  'connection-123',
  'eparagony',
  'Fiscal receipts',
  'active',
  {},
  'cred_123',
  new Date('2025-01-01'),
  new Date('2025-01-01'),
  undefined,
  ['Fiscalization'],
);

function fiscalRecord(
  status: 'registered' | 'failed',
  overrides: { registeredAt?: Date | null; updatedAt?: Date; failureReason?: string | null } = {},
): FiscalRegistrationRecord {
  const at = overrides.updatedAt ?? new Date('2025-01-01T10:00:00Z');
  return new FiscalRegistrationRecord(
    'fiscal-1',
    'connection-123',
    'ol_order_1',
    'eparagony',
    'fiscal:connection-123:ol_order_1',
    status,
    null,
    status === 'registered' ? '210' : null,
    null,
    overrides.registeredAt ?? null,
    null,
    null,
    status === 'failed' ? 'rejected' : null,
    overrides.failureReason ?? null,
    null,
    null,
    at,
    at,
  );
}

function invoiceRecord(
  status: 'issued' | 'failed',
  overrides: { issuedAt?: Date | null; updatedAt?: Date; failureReason?: string | null } = {},
): InvoiceRecord {
  const at = overrides.updatedAt ?? new Date('2025-01-01T10:00:00Z');
  return new InvoiceRecord(
    'invoice-1',
    'connection-123',
    'ol_order_1',
    'ksef',
    'invoice',
    status,
    null,
    null,
    'not-applicable',
    null,
    'invoice-key-1',
    null,
    overrides.issuedAt ?? null,
    null,
    at,
    at,
    status === 'failed' ? 'rejected' : null,
    null,
    overrides.failureReason ?? null,
    null,
  );
}

function syncJob(status: 'succeeded' | 'queued' | 'dead', updatedAt: Date, lastError: string | null = null): SyncJob {
  return new SyncJob(
    'job-1',
    'marketplace.orders.poll',
    'connection-123',
    {},
    status,
    'key-1',
    1,
    10,
    updatedAt,
    null,
    null,
    lastError,
    updatedAt,
    updatedAt,
  );
}

describe('ConnectionDiagnosticsResponseDto.fromDomain', () => {
  it('reports "Never" when no sync jobs, fiscal registrations or invoices exist', () => {
    const dto = ConnectionDiagnosticsResponseDto.fromDomain(CONNECTION, [], [], []);

    expect(dto.lastSucceededAt).toBeNull();
    expect(dto.lastFailedAt).toBeNull();
    expect(dto.recentErrors).toEqual([]);
    expect(dto.unreadableSources).toEqual([]);
  });

  it('defaults unreadableSources to empty when the caller omits it', () => {
    const dto = ConnectionDiagnosticsResponseDto.fromDomain(CONNECTION, []);

    expect(dto.unreadableSources).toEqual([]);
  });

  it('carries unreadableSources through verbatim, distinguishing "unknown" from a confirmed zero', () => {
    const dto = ConnectionDiagnosticsResponseDto.fromDomain(CONNECTION, [], [], [], [
      'fiscalRegistrations',
    ]);

    // Nothing observed from the two readable sources, so the timestamps are
    // still null - but unreadableSources says that null is NOT a confirmed
    // "Never", only "fiscalRegistrations could not be checked".
    expect(dto.lastSucceededAt).toBeNull();
    expect(dto.unreadableSources).toEqual(['fiscalRegistrations']);
  });

  it('reports a fiscal registration as the last success with no sync jobs at all', () => {
    const registered = fiscalRecord('registered', {
      registeredAt: new Date('2025-01-05T09:00:00Z'),
      updatedAt: new Date('2025-01-05T09:00:01Z'),
    });

    const dto = ConnectionDiagnosticsResponseDto.fromDomain(CONNECTION, [], [registered], []);

    expect(dto.lastSucceededAt).toBe('2025-01-05T09:00:00.000Z');
    expect(dto.lastFailedAt).toBeNull();
  });

  it('falls back to updatedAt when a registered record has no registeredAt', () => {
    const registered = fiscalRecord('registered', {
      registeredAt: null,
      updatedAt: new Date('2025-01-05T09:00:01Z'),
    });

    const dto = ConnectionDiagnosticsResponseDto.fromDomain(CONNECTION, [], [registered], []);

    expect(dto.lastSucceededAt).toBe('2025-01-05T09:00:01.000Z');
  });

  it('picks the most recent success across sync jobs, fiscal registrations and invoices', () => {
    const job = syncJob('succeeded', new Date('2025-01-01T10:00:00Z'));
    const registered = fiscalRecord('registered', { registeredAt: new Date('2025-01-03T00:00:00Z') });
    const issued = invoiceRecord('issued', { issuedAt: new Date('2025-01-06T00:00:00Z') });

    const dto = ConnectionDiagnosticsResponseDto.fromDomain(CONNECTION, [job], [registered], [issued]);

    expect(dto.lastSucceededAt).toBe('2025-01-06T00:00:00.000Z');
  });

  it('folds fiscal and invoice failure reasons into recentErrors alongside job errors', () => {
    const job = syncJob('dead', new Date('2025-01-01T10:00:00Z'), 'transport timeout');
    const failedFiscal = fiscalRecord('failed', { failureReason: 'authority rejected receipt' });
    const failedInvoice = invoiceRecord('failed', { failureReason: 'buyer VAT id rejected' });

    const dto = ConnectionDiagnosticsResponseDto.fromDomain(CONNECTION, [job], [failedFiscal], [failedInvoice]);

    expect(dto.recentErrors).toEqual([
      'transport timeout',
      'authority rejected receipt',
      'buyer VAT id rejected',
    ]);
  });

  it('counts a registered record as success but ignores an in-flight "registering" one', () => {
    const registered = fiscalRecord('registered', { registeredAt: null, updatedAt: new Date() });
    const inFlight = new FiscalRegistrationRecord(
      'fiscal-2',
      'connection-123',
      'ol_order_2',
      'eparagony',
      'fiscal:connection-123:ol_order_2',
      'registering',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      new Date(),
      new Date(),
      new Date(),
    );

    const dto = ConnectionDiagnosticsResponseDto.fromDomain(
      CONNECTION,
      [],
      [registered, inFlight],
      [],
    );

    expect(dto.lastSucceededAt).not.toBeNull();
    expect(dto.lastFailedAt).toBeNull();
  });
});
