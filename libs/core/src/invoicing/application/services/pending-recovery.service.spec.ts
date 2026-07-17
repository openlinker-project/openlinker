/**
 * Unit tests for `PendingRecoveryService` (#1703, mini-epic #1585; #1585 I3/I8).
 *
 * Mocks the repository, a `RegulatoryRecordLocator` adapter (no KSeF code), and
 * the sync-jobs service. Pins:
 *  - never-claimed `pending` -> RE-DRIVE (requeue the dead issue job), never in-doubt;
 *  - crashed `issuing` found -> reconciled to its located outcome (issued unless
 *    the located result is rejected); not-found / no-locator -> in-doubt
 *    (`transport-timeout` code) + operator alert, never a silent auto-retry;
 *  - the safety-margin `olderThan` gate; per-record error counting (never
 *    rethrown); the intra-run keyset paging walk.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ISyncJobsService } from '@openlinker/core/sync';

import { Logger } from '@openlinker/shared/logging';

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
    idempotencyKey: string | null;
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
    overrides.idempotencyKey === undefined ? 'idem-1' : overrides.idempotencyKey,
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
    'documentNumber' in overrides ? overrides.documentNumber : 'FV/1',
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
  const fn = typeof locate === 'function' ? jest.fn(locate) : jest.fn().mockResolvedValue(locate);
  return { ...baseAdapter(), locateByQuery: fn } as unknown as InvoicingPort & RegulatoryRecordLocator;
}

describe('PendingRecoveryService', () => {
  let service: PendingRecoveryService;
  let repo: jest.Mocked<InvoiceRecordRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let syncJobs: jest.Mocked<ISyncJobsService>;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      updateOutcome: jest.fn().mockImplementation((id: string) => Promise.resolve(makeRecord({ id }))),
      findStuckPending: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findPendingSubmission: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<InvoiceRecordRepositoryPort>;

    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    syncJobs = {
      schedule: jest.fn(),
      requeueDeadByIdempotencyKey: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<ISyncJobsService>;

    service = new PendingRecoveryService(repo, integrations, syncJobs);
  });

  describe('never-claimed pending -> re-drive (#1585 I3)', () => {
    it('requeues the dead issue job and NEVER marks a pending row in-doubt', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      const record = makeRecord({ id: 'rec-pending', status: 'pending', idempotencyKey: 'invoice:c:o' });
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });
      (syncJobs.requeueDeadByIdempotencyKey as jest.Mock).mockResolvedValue(true);

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      expect(syncJobs.requeueDeadByIdempotencyKey).toHaveBeenCalledWith('invoice:c:o');
      // Never located, never marked in-doubt, never patched.
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result.reissued).toBe(1);
      expect(result.markedInDoubt).toBe(0);
      expect(result.recovered).toBe(0);
      expect(result.scanned).toBe(1);
    });

    it('leaves a pending row claimable (no in-doubt) when there is no dead job to re-drive', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      repo.findStuckPending.mockResolvedValue({
        items: [makeRecord({ id: 'rec-pending-2', status: 'pending' })],
        total: 1,
      });
      (syncJobs.requeueDeadByIdempotencyKey as jest.Mock).mockResolvedValue(false);

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result.reissued).toBe(0);
      expect(result.markedInDoubt).toBe(0);
      expect(result.scanned).toBe(1);
    });

    it('does not attempt a requeue for a keyless pending row', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      repo.findStuckPending.mockResolvedValue({
        items: [makeRecord({ id: 'rec-keyless', status: 'pending', idempotencyKey: null })],
        total: 1,
      });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      expect(syncJobs.requeueDeadByIdempotencyKey).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result.reissued).toBe(0);
      expect(result.markedInDoubt).toBe(0);
    });
  });

  describe('authority lookup + safety margin (issuing arm)', () => {
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
      const expected = before - STUCK_PENDING_SAFETY_MARGIN_MS;
      expect(opts.olderThan.getTime()).toBeGreaterThanOrEqual(expected - 50);
      expect(opts.olderThan.getTime()).toBeLessThanOrEqual(Date.now() - STUCK_PENDING_SAFETY_MARGIN_MS + 50);
    });

    it('derives locate criteria (documentNumber + issue-date window) from an issuing record', async () => {
      const adapter = locatorAdapter(null);
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      const record = makeRecord({
        status: 'issuing',
        documentNumber: 'FV/2026/42',
        issuedAt: new Date('2026-06-01T10:00:00Z'),
      });
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });

      await service.recover(CONNECTION_ID, { limit: 50 });

      const criteria = ((adapter.locateByQuery as jest.Mock).mock.calls[0] as [Record<string, unknown>])[0];
      expect(criteria.documentNumber).toBe('FV/2026/42');
      expect((criteria.issuedFrom as Date).getTime()).toBeLessThan(new Date('2026-06-01T10:00:00Z').getTime());
      expect((criteria.issuedTo as Date).getTime()).toBeGreaterThan(new Date('2026-06-01T10:00:00Z').getTime());
    });
  });

  describe('issuing found on the authority side -> reconcile', () => {
    it('patches status=issued, the located status, clearanceReference and clears the lease', async () => {
      const record = makeRecord({ id: 'rec-found', status: 'issuing' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        locatorAdapter({ providerInvoiceId: 'PROV-9', regulatoryStatus: 'accepted', clearanceReference: 'KSEF-9' }),
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
    });

    it('does NOT force status=issued when the located result is rejected (#1585 suggestion)', async () => {
      const record = makeRecord({ id: 'rec-rej', status: 'issuing' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        locatorAdapter({ providerInvoiceId: null, regulatoryStatus: 'rejected', clearanceReference: null }),
      );
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });

      await service.recover(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch).toEqual({ regulatoryStatus: 'rejected', leaseExpiresAt: null });
      expect('status' in patch).toBe(false);
    });
  });

  describe('issuing not found / no-locator -> fiscal-safe in-doubt (#1585 I8)', () => {
    it('marks the record failed in-doubt with the transport-timeout code + operator alert', async () => {
      const record = makeRecord({ id: 'rec-orphan', status: 'issuing' });
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch.status).toBe('failed');
      expect(patch.failureMode).toBe('in-doubt');
      expect(patch.failureCode).toBe('transport-timeout');
      expect(typeof patch.failureReason).toBe('string');
      expect(patch.leaseExpiresAt).toBeNull();
      expect(result.markedInDoubt).toBe(1);
      expect(result.recovered).toBe(0);
    });

    it('marks an issuing record in-doubt without a locator, never calling one', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(baseAdapter());
      repo.findStuckPending.mockResolvedValue({
        items: [makeRecord({ id: 'rec-x', status: 'issuing' })],
        total: 1,
      });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch.status).toBe('failed');
      expect(patch.failureMode).toBe('in-doubt');
      expect(result.markedInDoubt).toBe(1);
    });

    it('does not reconcile a numberless issuing orphan even when the authority holds a lone unrelated result (#1585 B1)', async () => {
      const locate = jest.fn((criteria: { documentNumber?: string }) =>
        Promise.resolve(
          criteria.documentNumber
            ? { providerInvoiceId: 'PROV-Z', regulatoryStatus: 'accepted' as RegulatoryStatus, clearanceReference: 'KSEF-Z' }
            : null,
        ),
      );
      integrations.getCapabilityAdapter.mockResolvedValue({
        ...baseAdapter(),
        locateByQuery: locate,
      } as unknown as InvoicingPort & RegulatoryRecordLocator);
      const record = makeRecord({ id: 'rec-numberless', status: 'issuing', documentNumber: null });
      repo.findStuckPending.mockResolvedValue({ items: [record], total: 1 });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      expect((locate.mock.calls[0] as [{ documentNumber?: string }])[0].documentNumber).toBeUndefined();
      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch.status).toBe('failed');
      expect(patch.failureMode).toBe('in-doubt');
      expect(result.markedInDoubt).toBe(1);
      expect(result.recovered).toBe(0);
    });
  });

  describe('error handling', () => {
    it('increments errors and continues the sweep when a per-record lookup throws', async () => {
      const ok = makeRecord({ id: 'rec-ok', status: 'issuing' });
      const adapter = locatorAdapter((criteria) =>
        (criteria as { documentNumber?: string }).documentNumber === 'FAIL'
          ? Promise.reject(new Error('authority timeout'))
          : Promise.resolve({ providerInvoiceId: null, regulatoryStatus: 'accepted', clearanceReference: null }),
      );
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findStuckPending.mockResolvedValue({
        items: [makeRecord({ id: 'rec-fail', status: 'issuing', documentNumber: 'FAIL' }), ok],
        total: 2,
      });

      const result = await service.recover(CONNECTION_ID, { limit: 50 });

      expect(result.errors).toBe(1);
      expect(result.recovered).toBe(1);
      expect(result.scanned).toBe(2);
    });

    it('does not re-throw when a per-record recovery throws', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        locatorAdapter(() => Promise.reject(new Error('boom'))),
      );
      repo.findStuckPending.mockResolvedValue({ items: [makeRecord({ status: 'issuing' })], total: 1 });

      await expect(service.recover(CONNECTION_ID, { limit: 50 })).resolves.toMatchObject({ errors: 1 });
    });
  });

  describe('intra-run keyset paging', () => {
    it('pages forward by (updatedAt, id) until a short page drains the frontier', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      const page1 = [
        makeRecord({ id: 'a', status: 'issuing', updatedAt: new Date('2026-06-01T10:00:00Z') }),
        makeRecord({ id: 'b', status: 'issuing', updatedAt: new Date('2026-06-01T11:00:00Z') }),
      ];
      const page2 = [makeRecord({ id: 'c', status: 'issuing', updatedAt: new Date('2026-06-01T12:00:00Z') })];
      repo.findStuckPending
        .mockResolvedValueOnce({ items: page1, total: 3 })
        .mockResolvedValueOnce({ items: page2, total: 3 });

      const result = await service.recover(CONNECTION_ID, { limit: 2 });

      expect(repo.findStuckPending).toHaveBeenCalledTimes(2);
      const calls = (repo.findStuckPending as jest.Mock).mock.calls as Array<
        [unknown, { cursor?: { updatedAt: Date; id: string } }]
      >;
      expect(calls[1][1].cursor).toEqual({ updatedAt: new Date('2026-06-01T11:00:00Z'), id: 'b' });
      expect(result.scanned).toBe(3);
      expect(result.total).toBe(3);
    });

    it('stops after the first page when it is short (fewer than limit rows)', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(locatorAdapter(null));
      repo.findStuckPending.mockResolvedValue({ items: [makeRecord({ status: 'issuing' })], total: 1 });

      await service.recover(CONNECTION_ID, { limit: 50 });

      expect(repo.findStuckPending).toHaveBeenCalledTimes(1);
    });
  });

  describe('lingering pending-submission WARN (#1585 F6)', () => {
    beforeEach(() => {
      // The lingering check runs after adapter resolution; a base Invoicing
      // adapter (no locator needed) is enough to reach it.
      integrations.getCapabilityAdapter.mockResolvedValue(baseAdapter());
    });

    it('WARNs once (with the total count) when the oldest pending-submission record is past the business-day deadline', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      // createdAt defaults to 2026-06-01 — far beyond the ~20 business-hour window.
      repo.findPendingSubmission.mockResolvedValue({
        items: [makeRecord({ id: 'rec-linger', regulatoryStatus: 'pending-submission' })],
        total: 3,
      });

      await service.recover(CONNECTION_ID, { limit: 50 });

      expect(repo.findPendingSubmission).toHaveBeenCalledWith(CONNECTION_ID, { limit: 1 });
      const lingerWarn = warnSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('pending-submission invoice lingering'),
      );
      expect(lingerWarn?.[0]).toContain('rec-linger');
      expect(lingerWarn?.[0]).toContain('3 pending-submission total');
      warnSpy.mockRestore();
    });

    it('does NOT WARN when there is no pending-submission backlog', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      repo.findPendingSubmission.mockResolvedValue({ items: [], total: 0 });

      await service.recover(CONNECTION_ID, { limit: 50 });

      const lingerWarn = warnSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('pending-submission invoice lingering'),
      );
      expect(lingerWarn).toBeUndefined();
      warnSpy.mockRestore();
    });

    it('swallows a findPendingSubmission failure without breaking the crash-recovery sweep', async () => {
      repo.findPendingSubmission.mockRejectedValue(new Error('index unavailable'));

      await expect(service.recover(CONNECTION_ID, { limit: 50 })).resolves.toBeDefined();
      // The stuck-pending scan still ran despite the lingering-check failure.
      expect(repo.findStuckPending).toHaveBeenCalledTimes(1);
    });
  });
});
