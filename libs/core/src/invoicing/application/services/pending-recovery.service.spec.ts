/**
 * Unit tests for `PendingRecoveryService` (#1703, mini-epic #1585).
 *
 * Mocks the repository and a `RegulatoryRecordLocator` adapter (no KSeF code).
 * Pins: found -> reconciled (issued/accepted + reference); not-found -> in-doubt
 * + operator alert; no-locator -> in-doubt (never a silent auto-retry); the
 * safety-margin `olderThan` gate handed to the repo; per-record error counting
 * (never rethrown); and the intra-run keyset paging walk.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import type { RegulatoryRecordLocator } from '../../domain/ports/capabilities/regulatory-record-locator.capability';
import type {
  InvoiceStatus,
  RegulatoryLocateResult,
  RegulatoryStatus,
} from '../../domain/types/invoicing.types';
import {
  PendingRecoveryService,
  STUCK_PENDING_SAFETY_MARGIN_MS,
} from './pending-recovery.service';

const CONNECTION_ID = 'conn-invoicing-1';

function makeRecord(
  overrides: Partial<{
    id: string;
    status: InvoiceStatus;
    regulatoryStatus: RegulatoryStatus;
    providerInvoiceId: string | null;
    clearanceReference: string | null;
    documentNumber: string | null;
    issuedAt: Date | null;
    updatedAt: Date;
    leaseExpiresAt: Date | null;
  }> = {},
): InvoiceRecord {
  return new InvoiceRecord(
    overrides.id ?? 'rec-1',
    CONNECTION_ID,
    'order-1',
    'ksef',
    'invoice',
    overrides.status ?? 'issuing',
    overrides.providerInvoiceId ?? null,
    null,
    overrides.regulatoryStatus ?? 'not-applicable',
    overrides.clearanceReference ?? null,
    'idem-1',
    null,
    overrides.issuedAt ?? null,
    null,
    new Date('2026-06-01T10:00:00Z'),
    overrides.updatedAt ?? new Date('2026-06-01T10:00:00Z'),
    null, // failureMode
    null, // failureCode
    null, // failureReason
    overrides.leaseExpiresAt ?? null,
    false, // hasBuyerTaxId
    null, // documentContent
    null, // sourceDocument
    null, // issuedLineSnapshot
    'unknown', // paymentStatus
    null, // numberingSeriesId
    overrides.documentNumber ?? 'FV/1',
  );
}

/** A base Invoicing adapter that does NOT implement RegulatoryRecordLocator. */
function baseAdapter(): InvoicingPort {
  return {
    issueInvoice: jest.fn(),
    getInvoice: jest.fn(),
    upsertCustomer: jest.fn(),
    getSupportedDocumentTypes: jest.fn().mockReturnValue(['invoice']),
  } as unknown as InvoicingPort;
}

/** An Invoicing adapter that also implements the RegulatoryRecordLocator sub-capability. */
function locatorAdapter(
  locate:
    | RegulatoryLocateResult
    | null
    | ((criteria: unknown) => Promise<RegulatoryLocateResult | null>),
): InvoicingPort & RegulatoryRecordLocator {
  const fn =
    typeof locate === 'function' ? jest.fn(locate) : jest.fn().mockResolvedValue(locate);
  return {
    ...baseAdapter(),
    locateByQuery: fn,
  } as unknown as InvoicingPort & RegulatoryRecordLocator;
}

describe('PendingRecoveryService', () => {
  let service: PendingRecoveryService;
  let repo: jest.Mocked<InvoiceRecordRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      updateOutcome: jest
        .fn()
        .mockImplementation((id: string) => Promise.resolve(makeRecord({ id }))),
      findStuckPending: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<InvoiceRecordRepositoryPort>;

    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new PendingRecoveryService(repo, integrations);
  });

  describe('authority lookup + safety margin', () => {
    it('queries the stuck frontier gated by an olderThan of now minus the safety margin', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      const before = Date.now();

      await service.recover(CONNECTION_ID, { limit: 50 });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONNECTION_ID, 'Invoicing');
      expect(repo.findStuckPending).toHaveBeenCalledTimes(1);
      const [connArg, opts] = (repo.findStuckPending as jest.Mock).mock.calls[0] as [
        string,
        { olderThan: Date; limit: number; cursor?: unknown },
      ];
      expect(connArg).toBe(CONNECTION_ID);
      expect(opts.limit).toBe(50);
      expect(opts.cursor).toBeUndefined();
      // olderThan ~= now - STUCK_PENDING_SAFETY_MARGIN_MS (within a small window).
      const expected = before - STUCK_PENDING_SAFETY_MARGIN_MS;
      expect(opts.olderThan.getTime()).toBeGreaterThanOrEqual(expected - 50);
      expect(opts.olderThan.getTime()).toBeLessThanOrEqual(Date.now() - STUCK_PENDING_SAFETY_MARGIN_MS + 50);
    });

    it('derives locate criteria (documentNumber + issue-date window) from the record', async () => {
      const adapter = locatorAdapter(null);
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      const record = makeRecord({
        documentNumber: 'FV/2026/42',
        issuedAt: new Date('2026-06-01T10:00:00Z'),
      });
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });

      await service.recover(CONNECTION_ID, { limit: 50 });

      const criteria = ((adapter.locateByQuery as jest.Mock).mock.calls[0] as [Record<string, unknown>])[0];
      expect(criteria.documentNumber).toBe('FV/2026/42');
      expect(criteria.issuedFrom).toBeInstanceOf(Date);
      expect(criteria.issuedTo).toBeInstanceOf(Date);
      expect((criteria.issuedFrom as Date).getTime()).toBeLessThan(
        new Date('2026-06-01T10:00:00Z').getTime(),
      );
      expect((criteria.issuedTo as Date).getTime()).toBeGreaterThan(
        new Date('2026-06-01T10:00:00Z').getTime(),
      );
    });
  });

  describe('found on the authority side -> reconcile', () => {
    it('patches status=issued, regulatoryStatus=accepted, clearanceReference and clears the lease', async () => {
      const record = makeRecord({ id: 'rec-found', status: 'issuing' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        locatorAdapter({
          providerInvoiceId: 'PROV-9',
          regulatoryStatus: 'accepted',
          clearanceReference: 'KSEF-9',
        }),
      );
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-found', {
        status: 'issued',
        regulatoryStatus: 'accepted',
        leaseExpiresAt: null,
        providerInvoiceId: 'PROV-9',
        clearanceReference: 'KSEF-9',
      });
      expect(result.recovered).toBe(1);
      expect(result.markedInDoubt).toBe(0);
      expect(result.scanned).toBe(1);
    });

    it('omits providerInvoiceId / clearanceReference when the lookup returns null for them', async () => {
      const record = makeRecord({ id: 'rec-found-2' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        locatorAdapter({ providerInvoiceId: null, regulatoryStatus: 'accepted', clearanceReference: null }),
      );
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });

      await service.recover(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch).toEqual({ status: 'issued', regulatoryStatus: 'accepted', leaseExpiresAt: null });
      expect('providerInvoiceId' in patch).toBe(false);
      expect('clearanceReference' in patch).toBe(false);
    });
  });

  describe('not found -> fiscal-safe in-doubt', () => {
    it('marks the record failed in-doubt with an operator-visible alert and never auto-retries', async () => {
      const record = makeRecord({ id: 'rec-orphan' });
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch.status).toBe('failed');
      expect(patch.failureMode).toBe('in-doubt');
      expect(patch.failureCode).toBe('provider-error');
      expect(typeof patch.failureReason).toBe('string');
      expect(typeof patch.errorMessage).toBe('string');
      expect(patch.leaseExpiresAt).toBeNull();
      expect(result.markedInDoubt).toBe(1);
      expect(result.recovered).toBe(0);
    });
  });

  describe('no locator capability -> in-doubt', () => {
    it('marks every stuck record in-doubt without ever calling a locator', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(baseAdapter());
      repo.findStuckPending.mockResolvedValue({ items: [makeRecord({ id: 'rec-x' })], total: 1 });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch.status).toBe('failed');
      expect(patch.failureMode).toBe('in-doubt');
      expect(result.markedInDoubt).toBe(1);
      // The frontier is still swept even without a locator (records must be resolved).
      expect(repo.findStuckPending).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('increments errors and continues the sweep when a per-record lookup throws', async () => {
      const ok = makeRecord({ id: 'rec-ok' });
      const adapter = locatorAdapter((criteria) =>
        (criteria as { documentNumber?: string }).documentNumber === 'FAIL'
          ? Promise.reject(new Error('authority timeout'))
          : Promise.resolve({ providerInvoiceId: null, regulatoryStatus: 'accepted', clearanceReference: null }),
      );
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findStuckPending.mockResolvedValue({
        items: [makeRecord({ id: 'rec-fail', documentNumber: 'FAIL' }), ok],
        total: 2,
      });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      expect(result.errors).toBe(1);
      // The sweep continued and reconciled the second record.
      expect(result.recovered).toBe(1);
      expect(result.scanned).toBe(2);
    });

    it('does not re-throw when a per-record recovery throws', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        locatorAdapter(() => Promise.reject(new Error('boom'))),
      );
      repo.findStuckPending.mockResolvedValue({ items: [makeRecord()], total: 1 });

      await expect(service.recover(CONNECTION_ID, { limit: 50 })).resolves.toMatchObject({
        errors: 1,
      });
    });
  });

  describe('intra-run keyset paging', () => {
    it('pages forward by (updatedAt, id) until a short page drains the frontier', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      const page1 = [
        makeRecord({ id: 'a', updatedAt: new Date('2026-06-01T10:00:00Z') }),
        makeRecord({ id: 'b', updatedAt: new Date('2026-06-01T11:00:00Z') }),
      ];
      const page2 = [makeRecord({ id: 'c', updatedAt: new Date('2026-06-01T12:00:00Z') })];
      repo.findStuckPending
        .mockResolvedValueOnce({ items: page1, total: 3 })
        .mockResolvedValueOnce({ items: page2, total: 3 });

      const result = await service.recover(CONNECTION_ID, { limit: 2 });

      expect(repo.findStuckPending).toHaveBeenCalledTimes(2);
      // Page 2 is bounded strictly after the last row of page 1 (b @ 11:00).
      const secondCallOpts = (repo.findStuckPending as jest.Mock).mock.calls[1][1] as {
        cursor?: { updatedAt: Date; id: string };
      };
      expect(secondCallOpts.cursor).toEqual({
        updatedAt: new Date('2026-06-01T11:00:00Z'),
        id: 'b',
      });
      expect(result.scanned).toBe(3);
      expect(result.total).toBe(3);
    });

    it('stops after the first page when it is short (fewer than limit rows)', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      repo.findStuckPending.mockResolvedValue({ items: [makeRecord()], total: 1 });

      await service.recover(CONNECTION_ID, { limit: 50 });

      expect(repo.findStuckPending).toHaveBeenCalledTimes(1);
    });
  });
});
