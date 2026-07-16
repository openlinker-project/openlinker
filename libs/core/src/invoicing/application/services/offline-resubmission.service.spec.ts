/**
 * Unit tests for `OfflineResubmissionService` (#1702, mini-epic #1585).
 *
 * Mocks the repository and an `OfflineResubmitter` adapter (no KSeF code). Pins
 * the guard-miss no-op, the success patch (status + providerInvoiceId +
 * clearanceReference), the write-on-change / monotonicity rules, per-record error
 * counting (never rethrown), and the intra-run keyset paging walk.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import type { OfflineResubmitter } from '../../domain/ports/capabilities/offline-resubmitter.capability';
import type { OfflineResubmitResult, RegulatoryStatus } from '../../domain/types/invoicing.types';
import { OfflineResubmissionService } from './offline-resubmission.service';

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

/** An Invoicing adapter that also implements the OfflineResubmitter sub-capability. */
function resubmitterAdapter(
  resubmit: OfflineResubmitResult | ((record: InvoiceRecord) => Promise<OfflineResubmitResult>),
): InvoicingPort & OfflineResubmitter {
  const fn = typeof resubmit === 'function' ? jest.fn(resubmit) : jest.fn().mockResolvedValue(resubmit);
  return {
    ...baseAdapter(),
    resubmit: fn,
  } as unknown as InvoicingPort & OfflineResubmitter;
}

describe('OfflineResubmissionService', () => {
  let service: OfflineResubmissionService;
  let repo: jest.Mocked<InvoiceRecordRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      updateOutcome: jest.fn().mockImplementation((id: string) => Promise.resolve(makeRecord({ id }))),
      findPendingSubmission: jest.fn().mockResolvedValue({ items: [], total: 0 }),
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
    it('queries the pending-submission frontier when the adapter is an OfflineResubmitter', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterAdapter({ regulatoryStatus: 'submitted', providerInvoiceId: null, clearanceReference: null }),
      );
      repo.findPendingSubmission.mockResolvedValue({
        items: [makeRecord()],
        total: 1,
      });

      await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONNECTION_ID, 'Invoicing');
      // First page of the intra-run keyset walk carries no cursor.
      expect(repo.findPendingSubmission).toHaveBeenCalledWith(CONNECTION_ID, {
        limit: 50,
        cursor: undefined,
      });
    });

    it('does not query the repo and returns a zeroed result when the adapter is not an OfflineResubmitter', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(baseAdapter());

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(repo.findPendingSubmission).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result).toEqual({ scanned: 0, updated: 0, resubmitErrors: 0, total: 0 });
    });
  });

  describe('write / resubmission semantics', () => {
    it('patches status + providerInvoiceId + clearanceReference when the resubmit advances the record', async () => {
      const record = makeRecord({ providerInvoiceId: null, clearanceReference: null });
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterAdapter({
          regulatoryStatus: 'submitted',
          providerInvoiceId: 'PROV-9',
          clearanceReference: 'KSEF-9',
        }),
      );
      repo.findPendingSubmission.mockResolvedValue({ items: [record], total: 1 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).toHaveBeenCalledWith(record.id, {
        regulatoryStatus: 'submitted',
        providerInvoiceId: 'PROV-9',
        clearanceReference: 'KSEF-9',
      });
      expect(result.updated).toBe(1);
      expect(result.scanned).toBe(1);
    });

    it('omits monotonic keys the resubmit returns null for (never clobbers a prior value)', async () => {
      const record = makeRecord({ providerInvoiceId: 'PROV-OLD', clearanceReference: 'KSEF-OLD' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterAdapter({ regulatoryStatus: 'submitted', providerInvoiceId: null, clearanceReference: null }),
      );
      repo.findPendingSubmission.mockResolvedValue({ items: [record], total: 1 });

      await service.resubmit(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch).toEqual({ regulatoryStatus: 'submitted' });
      expect('providerInvoiceId' in patch).toBe(false);
      expect('clearanceReference' in patch).toBe(false);
    });

    it('does not call updateOutcome when nothing changed (no-op write)', async () => {
      const record = makeRecord({ providerInvoiceId: 'PROV-1', clearanceReference: 'KSEF-1' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterAdapter({
          regulatoryStatus: 'pending-submission',
          providerInvoiceId: 'PROV-1',
          clearanceReference: 'KSEF-1',
        }),
      );
      repo.findPendingSubmission.mockResolvedValue({ items: [record], total: 1 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result.updated).toBe(0);
      expect(result.scanned).toBe(1);
    });

    it('writes a rejected verdict returned as data', async () => {
      const record = makeRecord();
      integrations.getCapabilityAdapter.mockResolvedValue(
        resubmitterAdapter({ regulatoryStatus: 'rejected', providerInvoiceId: null, clearanceReference: null }),
      );
      repo.findPendingSubmission.mockResolvedValue({ items: [record], total: 1 });

      await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).toHaveBeenCalledWith(record.id, { regulatoryStatus: 'rejected' });
    });
  });

  describe('error handling', () => {
    it('increments resubmitErrors and continues the sweep when resubmit throws', async () => {
      const failing = makeRecord({ id: 'rec-fail' });
      const ok = makeRecord({ id: 'rec-ok' });
      const adapter = resubmitterAdapter((record) =>
        record.id === 'rec-fail'
          ? Promise.reject(new Error('authority still down'))
          : Promise.resolve({ regulatoryStatus: 'submitted', providerInvoiceId: null, clearanceReference: null }),
      );
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({ items: [failing, ok], total: 2 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 50 });

      expect(result.resubmitErrors).toBe(1);
      // The sweep continued and resubmitted the second record.
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-ok', { regulatoryStatus: 'submitted' });
      expect(result.updated).toBe(1);
    });

    it('returns normally (does not re-throw) when a per-record resubmit throws', async () => {
      const adapter = resubmitterAdapter(() => Promise.reject(new Error('provider down')));
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({ items: [makeRecord()], total: 1 });

      await expect(service.resubmit(CONNECTION_ID, { limit: 50 })).resolves.toMatchObject({
        resubmitErrors: 1,
      });
    });

    it('logs only connectionId + record.id + error.name / bounded message - never the raw provider string', async () => {
      const longSecret = 'X'.repeat(2000);
      const adapter = resubmitterAdapter(() => Promise.reject(new Error(longSecret)));
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission.mockResolvedValue({
        items: [makeRecord({ id: 'rec-secret' })],
        total: 1,
      });

      const errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: (m: string) => void } }).logger,
          'error',
        )
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
      const adapter = resubmitterAdapter({
        regulatoryStatus: 'submitted',
        providerInvoiceId: null,
        clearanceReference: null,
      });
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);

      const recA = makeRecord({ id: 'rec-a', updatedAt: new Date('2026-06-01T10:00:00Z') });
      const recB = makeRecord({ id: 'rec-b', updatedAt: new Date('2026-06-01T10:05:00Z') });
      const recC = makeRecord({ id: 'rec-c', updatedAt: new Date('2026-06-01T10:10:00Z') });
      repo.findPendingSubmission
        .mockResolvedValueOnce({ items: [recA], total: 3 })
        .mockResolvedValueOnce({ items: [recB], total: 3 })
        .mockResolvedValueOnce({ items: [recC], total: 3 })
        .mockResolvedValueOnce({ items: [], total: 0 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 1 });

      expect(result.total).toBe(3);
      expect(result.scanned).toBe(3);
      expect(repo.findPendingSubmission).toHaveBeenNthCalledWith(1, CONNECTION_ID, {
        limit: 1,
        cursor: undefined,
      });
      expect(repo.findPendingSubmission).toHaveBeenNthCalledWith(2, CONNECTION_ID, {
        limit: 1,
        cursor: { updatedAt: recA.updatedAt, id: 'rec-a' },
      });
      expect(repo.findPendingSubmission).toHaveBeenNthCalledWith(3, CONNECTION_ID, {
        limit: 1,
        cursor: { updatedAt: recB.updatedAt, id: 'rec-b' },
      });
      // The TAIL row is reached and resubmitted.
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-c', { regulatoryStatus: 'submitted' });
    });

    it('advances the cursor past an error row so a still-down record does not starve newer rows', async () => {
      const recStuck = makeRecord({ id: 'rec-stuck', updatedAt: new Date('2026-06-01T09:00:00Z') });
      const recNew = makeRecord({ id: 'rec-new', updatedAt: new Date('2026-06-01T11:00:00Z') });
      const adapter = resubmitterAdapter((record) =>
        record.id === 'rec-stuck'
          ? Promise.reject(new Error('still down'))
          : Promise.resolve({ regulatoryStatus: 'submitted', providerInvoiceId: null, clearanceReference: null }),
      );
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      repo.findPendingSubmission
        .mockResolvedValueOnce({ items: [recStuck], total: 2 })
        .mockResolvedValueOnce({ items: [recNew], total: 2 })
        .mockResolvedValueOnce({ items: [], total: 2 });

      const result = await service.resubmit(CONNECTION_ID, { limit: 1 });

      expect(result.resubmitErrors).toBe(1);
      // The cursor advanced past the errored row...
      expect(repo.findPendingSubmission).toHaveBeenNthCalledWith(2, CONNECTION_ID, {
        limit: 1,
        cursor: { updatedAt: recStuck.updatedAt, id: 'rec-stuck' },
      });
      // ...so the tail row was reached and resubmitted within the same run.
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-new', { regulatoryStatus: 'submitted' });
    });
  });
});
