/**
 * Unit tests for `OfflineResubmissionService` (#1702, mini-epic #1585; #1585 B1
 * double-issue-guard hardening).
 *
 * Mocks the repository and an `OfflineResubmitter` (+ optional
 * `RegulatoryRecordLocator`) adapter (no KSeF code). Pins the guard-miss no-op,
 * the settling-margin query, the per-record CAS claim + lease release, the
 * write-on-change / monotonicity rules, per-record error counting (never
 * rethrown), the intra-run keyset paging walk, the confirm-non-receipt gate, the
 * no-locator fail-closed (never blind-resubmit), and the overlapping-run (lost
 * claim) guard.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import type { OfflineResubmitter } from '../../domain/ports/capabilities/offline-resubmitter.capability';
import type { RegulatoryRecordLocator } from '../../domain/ports/capabilities/regulatory-record-locator.capability';
import type {
  OfflineResubmitResult,
  RegulatoryLocateResult,
  RegulatoryStatus,
} from '../../domain/types/invoicing.types';
import {
  OfflineResubmissionService,
  OFFLINE_RESUBMIT_SETTLING_MARGIN_MS,
} from './offline-resubmission.service';

const CONNECTION_ID = 'conn-invoicing-1';

function makeRecord(
  overrides: Partial<{
    id: string;
    regulatoryStatus: RegulatoryStatus;
    providerInvoiceId: string | null;
    clearanceReference: string | null;
    updatedAt: Date;
  }> = {},
): InvoiceRecord {
  return new InvoiceRecord(
    overrides.id ?? 'rec-1',
    CONNECTION_ID,
    'order-1',
    'subiekt',
    'invoice',
    'issued',
    overrides.providerInvoiceId ?? null,
    'FV/1',
    overrides.regulatoryStatus ?? 'pending-submission',
    overrides.clearanceReference ?? null,
    'idem-1',
    null,
    new Date('2026-06-01T10:00:00Z'),
    null,
    new Date('2026-06-01T10:00:00Z'),
    overrides.updatedAt ?? new Date('2026-06-01T10:00:00Z'),
  );
}

/** A base Invoicing adapter that does NOT implement OfflineResubmitter. */
function baseAdapter(): InvoicingPort {
  return {
    issueInvoice: jest.fn(),
    getInvoice: jest.fn(),
    upsertCustomer: jest.fn(),
    getSupportedDocumentTypes: jest.fn().mockReturnValue(['invoice']),
  } as unknown as InvoicingPort;
}

/** An Invoicing adapter that implements OfflineResubmitter only (no locator). */
function resubmitterAdapter(
  resubmit: OfflineResubmitResult | ((record: InvoiceRecord) => Promise<OfflineResubmitResult>),
): InvoicingPort & OfflineResubmitter {
  const fn = typeof resubmit === 'function' ? jest.fn(resubmit) : jest.fn().mockResolvedValue(resubmit);
  return { ...baseAdapter(), resubmit: fn } as unknown as InvoicingPort & OfflineResubmitter;
}

/** An Invoicing adapter that implements BOTH OfflineResubmitter and RegulatoryRecordLocator. */
function resubmitterLocatorAdapter(
  resubmit: OfflineResubmitResult | ((record: InvoiceRecord) => Promise<OfflineResubmitResult>),
  locate:
    | RegulatoryLocateResult
    | null
    | ((criteria: unknown) => Promise<RegulatoryLocateResult | null>),
): InvoicingPort & OfflineResubmitter & RegulatoryRecordLocator {
  const resubmitFn =
    typeof resubmit === 'function' ? jest.fn(resubmit) : jest.fn().mockResolvedValue(resubmit);
  const locateFn =
    typeof locate === 'function' ? jest.fn(locate) : jest.fn().mockResolvedValue(locate);
  return {
    ...baseAdapter(),
    resubmit: resubmitFn,
    locateByQuery: locateFn,
  } as unknown as InvoicingPort & OfflineResubmitter & RegulatoryRecordLocator;
}

describe('OfflineResubmissionService', () => {
  let service: OfflineResubmissionService;
  let repo: jest.Mocked<InvoiceRecordRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  /** Records the per-record CAS claim resolves, keyed by id (echoes the page rows). */
  let claimable: Map<string, InvoiceRecord>;

  /** Register page rows so the default `claimPendingSubmission` echoes the SAME record. */
  function registerClaimable(...records: InvoiceRecord[]): InvoiceRecord[] {
    for (const r of records) {
      claimable.set(r.id, r);
    }
    return records;
  }

  beforeEach(() => {
    claimable = new Map();
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      updateOutcome: jest.fn().mockImplementation((id: string) => Promise.resolve(makeRecord({ id }))),
      findPendingSubmission: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      // Default: a WON claim echoes the registered page row (or a fresh one).
      claimPendingSubmission: jest
        .fn()
        .mockImplementation((id: string) => Promise.resolve(claimable.get(id) ?? makeRecord({ id }))),
    } as unknown as jest.Mocked<InvoiceRecordRepositoryPort>;

    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new OfflineResubmissionService(repo, integrations);
  });

  describe('adapter capability gating', () => {
    it('queries the pending-submission frontier with a settling-margin bound when the adapter is a locator+resubmitter', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterLocatorAdapter(
          { regulatoryStatus: 'submitted', providerInvoiceId: null, clearanceReference: null },
          null,
        ),
      );
      repo.findPendingSubmission.mockResolvedValue({
        items: registerClaimable(makeRecord()),
        total: 1,
      });

      await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONNECTION_ID, 'Invoicing');
      const call = (repo.findPendingSubmission as jest.Mock).mock.calls[0] as [
        string,
        { limit: number; cursor?: unknown; olderThan?: Date },
      ];
      expect(call[0]).toBe(CONNECTION_ID);
      expect(call[1].limit).toBe(50);
      expect(call[1].cursor).toBeUndefined();
      // Settling margin passed (older than ~now - margin).
      expect(call[1].olderThan).toBeInstanceOf(Date);
      const skewMs = Math.abs(
        Date.now() - OFFLINE_RESUBMIT_SETTLING_MARGIN_MS - (call[1].olderThan as Date).getTime(),
      );
      expect(skewMs).toBeLessThan(5000);
    });

    it('returns a zeroed result and does not query the repo when the adapter is not an OfflineResubmitter', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(baseAdapter());

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(repo.findPendingSubmission).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result).toEqual({ scanned: 0, updated: 0, resubmitErrors: 0, total: 0 });
    });
  });

  describe('write / resubmission semantics (locator confirms non-receipt first)', () => {
    it('patches status + providerInvoiceId + clearanceReference (and releases the lease) when the resubmit advances the record', async () => {
      const record = makeRecord({ providerInvoiceId: null, clearanceReference: null });
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterLocatorAdapter(
          { regulatoryStatus: 'submitted', providerInvoiceId: 'PROV-9', clearanceReference: 'KSEF-9' },
          null,
        ),
      );
      repo.findPendingSubmission.mockResolvedValue({ items: registerClaimable(record), total: 1 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(repo.claimPendingSubmission).toHaveBeenCalledWith(record.id, expect.any(Date));
      expect(repo.updateOutcome).toHaveBeenCalledWith(record.id, {
        regulatoryStatus: 'submitted',
        providerInvoiceId: 'PROV-9',
        clearanceReference: 'KSEF-9',
        leaseExpiresAt: null,
      });
      expect(result.updated).toBe(1);
      expect(result.scanned).toBe(1);
    });

    it('omits monotonic keys the resubmit returns null for (never clobbers a prior value)', async () => {
      const record = makeRecord({ providerInvoiceId: 'PROV-OLD', clearanceReference: 'KSEF-OLD' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterLocatorAdapter(
          { regulatoryStatus: 'submitted', providerInvoiceId: null, clearanceReference: null },
          null,
        ),
      );
      repo.findPendingSubmission.mockResolvedValue({ items: registerClaimable(record), total: 1 });

      await service.resubmit(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch).toEqual({ regulatoryStatus: 'submitted', leaseExpiresAt: null });
      expect('providerInvoiceId' in patch).toBe(false);
      expect('clearanceReference' in patch).toBe(false);
    });

    it('releases the lease WITHOUT a projection write when the resubmit leaves the record pending-submission', async () => {
      const record = makeRecord({ providerInvoiceId: 'PROV-1', clearanceReference: 'KSEF-1' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterLocatorAdapter(
          { regulatoryStatus: 'pending-submission', providerInvoiceId: 'PROV-1', clearanceReference: 'KSEF-1' },
          null,
        ),
      );
      repo.findPendingSubmission.mockResolvedValue({ items: registerClaimable(record), total: 1 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      // Only the lease release — no status/id churn while still pending-submission.
      expect(repo.updateOutcome).toHaveBeenCalledWith(record.id, { leaseExpiresAt: null });
      expect(result.updated).toBe(0);
      expect(result.scanned).toBe(1);
    });

    it('writes a rejected verdict returned as data', async () => {
      const record = makeRecord();
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterLocatorAdapter(
          { regulatoryStatus: 'rejected', providerInvoiceId: null, clearanceReference: null },
          null,
        ),
      );
      repo.findPendingSubmission.mockResolvedValue({ items: registerClaimable(record), total: 1 });

      await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).toHaveBeenCalledWith(record.id, {
        regulatoryStatus: 'rejected',
        leaseExpiresAt: null,
      });
    });
  });

  describe('confirm non-receipt before resubmitting (#1585 B1)', () => {
    it('reconciles WITHOUT resubmitting (releasing the lease) when the locator finds the document already at the authority', async () => {
      const resubmit = jest.fn();
      const record = makeRecord({ id: 'rec-landed', providerInvoiceId: null, clearanceReference: null });
      const adapter = resubmitterLocatorAdapter(
        (r) => {
          resubmit(r);
          return Promise.resolve({
            regulatoryStatus: 'submitted' as RegulatoryStatus,
            providerInvoiceId: null,
            clearanceReference: null,
          });
        },
        { providerInvoiceId: 'PROV-LANDED', regulatoryStatus: 'accepted', clearanceReference: 'KSEF-LANDED' },
      );
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({ items: registerClaimable(record), total: 1 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(adapter.locateByQuery).toHaveBeenCalledTimes(1);
      expect(resubmit).not.toHaveBeenCalled();
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-landed', {
        regulatoryStatus: 'accepted',
        providerInvoiceId: 'PROV-LANDED',
        clearanceReference: 'KSEF-LANDED',
        leaseExpiresAt: null,
      });
      expect(result.updated).toBe(1);
      expect(result.resubmitErrors).toBe(0);
    });

    it('resubmits when the locator does not find the document at the authority', async () => {
      const resubmit = jest.fn().mockResolvedValue({
        regulatoryStatus: 'submitted' as RegulatoryStatus,
        providerInvoiceId: 'PROV-NEW',
        clearanceReference: null,
      });
      const adapter = {
        ...baseAdapter(),
        resubmit,
        locateByQuery: jest.fn().mockResolvedValue(null),
      } as unknown as InvoicingPort & OfflineResubmitter & RegulatoryRecordLocator;
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({
        items: registerClaimable(makeRecord({ id: 'rec-absent', providerInvoiceId: null })),
        total: 1,
      });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(adapter.locateByQuery).toHaveBeenCalledTimes(1);
      expect(resubmit).toHaveBeenCalledTimes(1);
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-absent', {
        regulatoryStatus: 'submitted',
        providerInvoiceId: 'PROV-NEW',
        leaseExpiresAt: null,
      });
      expect(result.updated).toBe(1);
    });

    it('fails CLOSED: never resubmits when the adapter is not a RegulatoryRecordLocator', async () => {
      const adapter = resubmitterAdapter({
        regulatoryStatus: 'submitted',
        providerInvoiceId: 'PROV-1',
        clearanceReference: null,
      });
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({
        items: registerClaimable(makeRecord({ id: 'rec-nolocator' })),
        total: 1,
      });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(adapter.resubmit).not.toHaveBeenCalled();
      expect(repo.claimPendingSubmission).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result.updated).toBe(0);
      expect(result.scanned).toBe(1);
    });
  });

  describe('overlapping-run / CAS-claim guard (#1585 B1)', () => {
    it('skips a record WITHOUT resubmitting when the per-record claim is lost (another run holds it)', async () => {
      const resubmit = jest.fn().mockResolvedValue({
        regulatoryStatus: 'submitted' as RegulatoryStatus,
        providerInvoiceId: 'PROV-X',
        clearanceReference: null,
      });
      const locateByQuery = jest.fn().mockResolvedValue(null);
      integrations.getCapabilityAdapter.mockResolvedValue({
        ...baseAdapter(),
        resubmit,
        locateByQuery,
      } as unknown as InvoicingPort & OfflineResubmitter & RegulatoryRecordLocator);
      repo.findPendingSubmission.mockResolvedValue({ items: [makeRecord({ id: 'rec-contended' })], total: 1 });
      // Lost claim -> null.
      (repo.claimPendingSubmission as jest.Mock).mockResolvedValue(null);

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(repo.claimPendingSubmission).toHaveBeenCalledWith('rec-contended', expect.any(Date));
      expect(locateByQuery).not.toHaveBeenCalled();
      expect(resubmit).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result.scanned).toBe(1);
      expect(result.updated).toBe(0);
    });
  });

  describe('error handling', () => {
    it('increments resubmitErrors, releases the lease, and continues when a resubmit throws', async () => {
      const failing = makeRecord({ id: 'rec-fail' });
      const ok = makeRecord({ id: 'rec-ok' });
      const adapter = resubmitterLocatorAdapter(
        (record) =>
          record.id === 'rec-fail'
            ? Promise.reject(new Error('authority still down'))
            : Promise.resolve({ regulatoryStatus: 'submitted', providerInvoiceId: null, clearanceReference: null }),
        null,
      );
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({ items: registerClaimable(failing, ok), total: 2 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(result.resubmitErrors).toBe(1);
      // Lease released on the errored record.
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-fail', { leaseExpiresAt: null });
      // The sweep continued and resubmitted the second record.
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-ok', {
        regulatoryStatus: 'submitted',
        leaseExpiresAt: null,
      });
      expect(result.updated).toBe(1);
    });

    it('does not re-throw when a per-record resubmit throws', async () => {
      const adapter = resubmitterLocatorAdapter(() => Promise.reject(new Error('provider down')), null);
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({ items: registerClaimable(makeRecord()), total: 1 });

      await expect(service.resubmit(CONNECTION_ID, { limit: 50 })).resolves.toMatchObject({
        resubmitErrors: 1,
      });
    });

    it('logs only connectionId + record.id + error.name / bounded message - never the raw provider string', async () => {
      const longSecret = 'X'.repeat(2000);
      const adapter = resubmitterLocatorAdapter(() => Promise.reject(new Error(longSecret)), null);
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({
        items: registerClaimable(makeRecord({ id: 'rec-secret' })),
        total: 1,
      });

      const errorSpy = jest
        .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0];
      expect(logged).toContain(CONNECTION_ID);
      expect(logged).toContain('rec-secret');
      expect(logged).toContain('Error');
      expect(logged).not.toContain(longSecret);
      expect(logged).toContain('…[truncated]');
    });
  });

  describe('keyset paging', () => {
    it('walks the WHOLE pending frontier within ONE run via the (updatedAt, id) cursor when total > limit', async () => {
      const adapter = resubmitterLocatorAdapter(
        { regulatoryStatus: 'submitted', providerInvoiceId: null, clearanceReference: null },
        null,
      );
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      const recA = makeRecord({ id: 'rec-a', updatedAt: new Date('2026-06-01T10:00:00Z') });
      const recB = makeRecord({ id: 'rec-b', updatedAt: new Date('2026-06-01T10:05:00Z') });
      const recC = makeRecord({ id: 'rec-c', updatedAt: new Date('2026-06-01T10:10:00Z') });
      registerClaimable(recA, recB, recC);
      repo.findPendingSubmission
        .mockResolvedValueOnce({ items: [recA], total: 3 })
        .mockResolvedValueOnce({ items: [recB], total: 3 })
        .mockResolvedValueOnce({ items: [recC], total: 3 })
        .mockResolvedValueOnce({ items: [], total: 0 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 1 });

      expect(result.total).toBe(3);
      expect(result.scanned).toBe(3);
      const secondCall = (repo.findPendingSubmission as jest.Mock).mock.calls[1] as [string, { cursor?: unknown }];
      expect(secondCall[1].cursor).toEqual({ updatedAt: recA.updatedAt, id: 'rec-a' });
      const thirdCall = (repo.findPendingSubmission as jest.Mock).mock.calls[2] as [string, { cursor?: unknown }];
      expect(thirdCall[1].cursor).toEqual({ updatedAt: recB.updatedAt, id: 'rec-b' });
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-c', {
        regulatoryStatus: 'submitted',
        leaseExpiresAt: null,
      });
    });
  });
});
