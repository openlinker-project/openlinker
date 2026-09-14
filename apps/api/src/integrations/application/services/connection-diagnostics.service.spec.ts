/**
 * Connection Diagnostics Service Unit Tests
 *
 * The behaviour under test is the per-source degradation policy (#3179): three
 * independently-fallible reads, of which any subset may fail without taking
 * down the others, and every failure NAMED rather than folded in as a
 * healthy-looking zero. Exercised against the service directly, with no
 * controller module to stand up.
 *
 * @module apps/api/src/integrations/application/services
 */
import { NotFoundException } from '@nestjs/common';
import { Connection } from '@openlinker/core/identifier-mapping';
import { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { SyncJobRepositoryPort } from '@openlinker/core/sync';
import { FiscalRegistrationRecord } from '@openlinker/core/fiscalization';
import type { IFiscalRegistrationService } from '@openlinker/core/fiscalization';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type { IConnectionService } from '../interfaces/connection.service.interface';
import { ConnectionDiagnosticsService } from './connection-diagnostics.service';

const CONNECTION_ID = 'connection-123';

const connection = new Connection(
  CONNECTION_ID,
  'eparagony',
  'Fiscal receipts',
  'active',
  {},
  'cred_123',
  new Date('2025-01-01'),
  new Date('2025-01-01'),
  undefined,
  ['Fiscalization']
);

function syncJob(updatedAt: Date): SyncJob {
  return new SyncJob(
    'job-1',
    'marketplace.orders.poll',
    CONNECTION_ID,
    {},
    'succeeded',
    'key-1',
    1,
    10,
    updatedAt,
    null,
    null,
    null,
    updatedAt,
    updatedAt
  );
}

function fiscalRecord(registeredAt: Date): FiscalRegistrationRecord {
  return new FiscalRegistrationRecord(
    'fiscal-1',
    CONNECTION_ID,
    'ol_order_1',
    'eparagony',
    `fiscal:${CONNECTION_ID}:ol_order_1`,
    'registered',
    null,
    '210',
    null,
    registeredAt,
    null,
    null,
    null,
    null,
    null,
    null,
    registeredAt,
    registeredAt
  );
}

function invoiceRecord(issuedAt: Date): InvoiceRecord {
  return new InvoiceRecord(
    'invoice-1',
    CONNECTION_ID,
    'ol_order_1',
    'ksef',
    'invoice',
    'issued',
    null,
    null,
    'not-applicable',
    null,
    'invoice-key-1',
    null,
    issuedAt,
    null,
    issuedAt,
    issuedAt,
    null,
    null,
    null,
    null
  );
}

describe('ConnectionDiagnosticsService', () => {
  let connectionService: jest.Mocked<IConnectionService>;
  let syncJobRepository: jest.Mocked<SyncJobRepositoryPort>;
  let fiscalRegistrations: jest.Mocked<IFiscalRegistrationService>;
  let invoices: jest.Mocked<IInvoiceService>;
  let subject: ConnectionDiagnosticsService;

  beforeEach(() => {
    connectionService = {
      get: jest.fn().mockResolvedValue(connection),
    } as unknown as jest.Mocked<IConnectionService>;
    syncJobRepository = {
      findRecentByConnectionId: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SyncJobRepositoryPort>;
    fiscalRegistrations = {
      listRecentByConnectionId: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IFiscalRegistrationService>;
    invoices = {
      listRecentByConnectionId: jest.fn().mockResolvedValue([]),
      listInvoices: jest.fn(),
    } as unknown as jest.Mocked<IInvoiceService>;
    subject = new ConnectionDiagnosticsService(
      connectionService,
      syncJobRepository,
      fiscalRegistrations,
      invoices
    );
  });

  it('reads all three sources for the connection, each capped at the same window', async () => {
    const reads = await subject.getDiagnostics(CONNECTION_ID);

    expect(syncJobRepository.findRecentByConnectionId).toHaveBeenCalledWith(CONNECTION_ID, 10);
    expect(fiscalRegistrations.listRecentByConnectionId).toHaveBeenCalledWith(CONNECTION_ID, 10);
    expect(invoices.listRecentByConnectionId).toHaveBeenCalledWith(CONNECTION_ID, 10);
    expect(reads.connection).toBe(connection);
    expect(reads.unreadableSources).toEqual([]);
  });

  it('reads invoices through the bounded recency read, never the paginated list', async () => {
    // `listInvoices` ends in `getManyAndCount()`, whose COUNT always runs in
    // typeorm 0.3.17 — and this read discards a total (#2944).
    await subject.getDiagnostics(CONNECTION_ID);

    expect(invoices.listInvoices).not.toHaveBeenCalled();
  });

  it('returns every source it could read', async () => {
    syncJobRepository.findRecentByConnectionId.mockResolvedValue([
      syncJob(new Date('2025-01-01T10:01:00Z')),
    ]);
    fiscalRegistrations.listRecentByConnectionId.mockResolvedValue([
      fiscalRecord(new Date('2025-01-05T09:00:00Z')),
    ]);
    invoices.listRecentByConnectionId.mockResolvedValue([
      invoiceRecord(new Date('2025-01-06T09:00:00Z')),
    ]);

    const reads = await subject.getDiagnostics(CONNECTION_ID);

    expect(reads.recentJobs).toHaveLength(1);
    expect(reads.recentFiscalRegistrations).toHaveLength(1);
    expect(reads.recentInvoices).toHaveLength(1);
  });

  it('propagates a not-found connection rather than reporting an empty panel', async () => {
    const notFound = new NotFoundException('Connection not found');
    connectionService.get.mockRejectedValue(notFound);

    await expect(subject.getDiagnostics('unknown-id')).rejects.toBe(notFound);
    expect(syncJobRepository.findRecentByConnectionId).not.toHaveBeenCalled();
  });

  it('degrades ONE unreadable source rather than failing the whole read', async () => {
    syncJobRepository.findRecentByConnectionId.mockResolvedValue([
      syncJob(new Date('2025-01-01T10:01:00Z')),
    ]);
    fiscalRegistrations.listRecentByConnectionId.mockRejectedValue(
      new Error('fiscal_registration_records unreachable')
    );

    const reads = await subject.getDiagnostics(CONNECTION_ID);

    // The still-readable sources are reported normally...
    expect(reads.recentJobs).toHaveLength(1);
    // ...and the unreadable one is named, never silently folded in as "no
    // fiscal activity" (a healthy-looking zero it did not actually confirm).
    expect(reads.recentFiscalRegistrations).toEqual([]);
    expect(reads.unreadableSources).toEqual(['fiscalRegistrations']);
  });

  it('names every unreadable source when all three legs reject', async () => {
    syncJobRepository.findRecentByConnectionId.mockRejectedValue(new Error('db down'));
    fiscalRegistrations.listRecentByConnectionId.mockRejectedValue(new Error('db down'));
    invoices.listRecentByConnectionId.mockRejectedValue(new Error('db down'));

    const reads = await subject.getDiagnostics(CONNECTION_ID);

    expect(reads.recentJobs).toEqual([]);
    expect(reads.recentFiscalRegistrations).toEqual([]);
    expect(reads.recentInvoices).toEqual([]);
    expect(reads.unreadableSources).toEqual(['syncJobs', 'fiscalRegistrations', 'invoices']);
  });

  it('reports no unreadable source when every read merely came back empty', async () => {
    const reads = await subject.getDiagnostics(CONNECTION_ID);

    // An empty read is a confirmed absence; only a REJECTED one is unknown.
    expect(reads.unreadableSources).toEqual([]);
  });
});
