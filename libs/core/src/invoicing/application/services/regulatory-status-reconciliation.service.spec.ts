/**
 * Unit tests for `RegulatoryStatusReconciliationService` (#1121).
 *
 * Mocks the repository and a `RegulatoryStatusReader` adapter (no #753/Subiekt
 * code). Pins the selection scope, the write/monotonicity/idempotency rules
 * (plan decision #8), the guard-miss no-op, bounded error logging, and
 * eventual coverage.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import type { RegulatoryStatusReader } from '../../domain/ports/capabilities/regulatory-status-reader.capability';
import type { RegulatoryStatus } from '../../domain/types/invoicing.types';
import type { RegulatoryClearanceResult } from '../../domain/types/invoicing.types';
import { RegulatoryStatusReconciliationService } from './regulatory-status-reconciliation.service';

const CONNECTION_ID = 'conn-invoicing-1';

function makeRecord(
  overrides: Partial<{
    id: string;
    status: 'pending' | 'issued' | 'failed';
    regulatoryStatus: RegulatoryStatus;
    clearanceReference: string | null;
    clearanceDetail: string | null;
    updatedAt: Date;
  }> = {},
): InvoiceRecord {
  return new InvoiceRecord(
    overrides.id ?? 'rec-1',
    CONNECTION_ID,
    'order-1',
    'subiekt',
    'invoice',
    overrides.status ?? 'issued',
    'prov-inv-1',
    'FV/1',
    overrides.regulatoryStatus ?? 'submitted',
    overrides.clearanceReference ?? null,
    'idem-1',
    null,
    new Date('2026-06-01T10:00:00Z'),
    null,
    new Date('2026-06-01T10:00:00Z'),
    overrides.updatedAt ?? new Date('2026-06-01T10:00:00Z'),
    null,
    null,
    null,
    null,
    false,
    null,
    null,
    null,
    'unknown',
    overrides.clearanceDetail ?? null,
  );
}

/** A base Invoicing adapter that does NOT implement RegulatoryStatusReader. */
function baseAdapter(): InvoicingPort {
  return {
    issueInvoice: jest.fn(),
    getInvoice: jest.fn(),
    upsertCustomer: jest.fn(),
    getSupportedDocumentTypes: jest.fn().mockReturnValue(['invoice']),
  } as unknown as InvoicingPort;
}

/** An Invoicing adapter that also implements the RegulatoryStatusReader sub-capability. */
function readerAdapter(
  read: RegulatoryClearanceResult | ((record: InvoiceRecord) => Promise<RegulatoryClearanceResult>),
): InvoicingPort & RegulatoryStatusReader {
  const fn =
    typeof read === 'function'
      ? jest.fn(read)
      : jest.fn().mockResolvedValue(read);
  return {
    ...baseAdapter(),
    getClearanceStatus: fn,
  } as unknown as InvoicingPort & RegulatoryStatusReader;
}

describe('RegulatoryStatusReconciliationService', () => {
  let service: RegulatoryStatusReconciliationService;
  let repo: jest.Mocked<InvoiceRecordRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      updateOutcome: jest.fn().mockImplementation((id: string) => Promise.resolve(makeRecord({ id }))),
      findIssuedNonTerminal: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<InvoiceRecordRepositoryPort>;

    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new RegulatoryStatusReconciliationService(repo, integrations);
  });

  describe('selection scope', () => {
    it('queries only issued + non-terminal records (delegates the predicate to the repo)', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        readerAdapter({ regulatoryStatus: 'submitted', clearanceReference: null }),
      );
      repo.findIssuedNonTerminal.mockResolvedValue({
        items: [makeRecord({ regulatoryStatus: 'submitted' })],
        total: 1,
      });

      await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONNECTION_ID, 'Invoicing');
      // First page of the intra-run keyset walk carries no cursor.
      expect(repo.findIssuedNonTerminal).toHaveBeenCalledWith(CONNECTION_ID, {
        limit: 50,
        cursor: undefined,
      });
    });

    it('does not query the repo and returns a zeroed result when the adapter is not a RegulatoryStatusReader', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(baseAdapter());

      const result = await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(repo.findIssuedNonTerminal).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result).toEqual({ scanned: 0, updated: 0, skippedTerminal: 0, readErrors: 0, total: 0 });
    });
  });

  describe('write / reconciliation semantics (decision #8)', () => {
    it('writes a non-terminal record terminal when the authoritative read returns accepted (8a)', async () => {
      const record = makeRecord({ regulatoryStatus: 'submitted' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        readerAdapter({ regulatoryStatus: 'accepted', clearanceReference: 'KSEF-123' }),
      );
      repo.findIssuedNonTerminal.mockResolvedValue({ items: [record], total: 1 });

      const result = await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).toHaveBeenCalledWith(record.id, {
        regulatoryStatus: 'accepted',
        clearanceReference: 'KSEF-123',
      });
      expect(result.updated).toBe(1);
    });

    it('writes a non-terminal record terminal when the authoritative read returns rejected (8a)', async () => {
      const record = makeRecord({ regulatoryStatus: 'submitted' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        readerAdapter({ regulatoryStatus: 'rejected', clearanceReference: null }),
      );
      repo.findIssuedNonTerminal.mockResolvedValue({ items: [record], total: 1 });

      await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).toHaveBeenCalledWith(record.id, { regulatoryStatus: 'rejected' });
    });

    it('persists the clearanceDetail from a rejected read (#1582)', async () => {
      const record = makeRecord({ regulatoryStatus: 'submitted', clearanceReference: null });
      integrations.getCapabilityAdapter.mockResolvedValue(
        readerAdapter({
          regulatoryStatus: 'rejected',
          clearanceReference: null,
          clearanceDetail: 'KSeF status 440: buyer NIP invalid',
        }),
      );
      repo.findIssuedNonTerminal.mockResolvedValue({ items: [record], total: 1 });

      await service.reconcile(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch['clearanceDetail']).toBe('KSeF status 440: buyer NIP invalid');
    });

    it('defensive-skips a record whose CURRENT status is already terminal (race guard, 8a) and increments skippedTerminal', async () => {
      const reader = readerAdapter({ regulatoryStatus: 'submitted', clearanceReference: null });
      integrations.getCapabilityAdapter.mockResolvedValue(reader);
      // A row that slipped through the predicate but is already terminal.
      repo.findIssuedNonTerminal.mockResolvedValue({
        items: [makeRecord({ regulatoryStatus: 'accepted' })],
        total: 1,
      });

      const result = await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect((reader.getClearanceStatus as jest.Mock)).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result.skippedTerminal).toBe(1);
      expect(result.scanned).toBe(0);
    });

    it('preserves an existing clearanceReference when the read returns null AND omits the clearanceReference key from the patch (8b)', async () => {
      const record = makeRecord({ regulatoryStatus: 'submitted', clearanceReference: 'KSEF-EXISTING' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        readerAdapter({ regulatoryStatus: 'accepted', clearanceReference: null }),
      );
      repo.findIssuedNonTerminal.mockResolvedValue({ items: [record], total: 1 });

      await service.reconcile(CONNECTION_ID, { limit: 50 });

      const patch = ((repo.updateOutcome as jest.Mock).mock.calls[0] as [unknown, Record<string, unknown>])[1];
      expect(patch).toEqual({ regulatoryStatus: 'accepted' });
      expect('clearanceReference' in patch).toBe(false);
    });

    it('persists clearanceReference only when the read is non-null and changed (8b)', async () => {
      const record = makeRecord({ regulatoryStatus: 'submitted', clearanceReference: null });
      integrations.getCapabilityAdapter.mockResolvedValue(
        readerAdapter({ regulatoryStatus: 'cleared', clearanceReference: 'KSEF-NEW' }),
      );
      repo.findIssuedNonTerminal.mockResolvedValue({ items: [record], total: 1 });

      await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).toHaveBeenCalledWith(record.id, {
        regulatoryStatus: 'cleared',
        clearanceReference: 'KSEF-NEW',
      });
    });

    it('does not call updateOutcome when nothing changed (no-op write, 8c)', async () => {
      const record = makeRecord({ regulatoryStatus: 'submitted', clearanceReference: 'KSEF-1' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        readerAdapter({ regulatoryStatus: 'submitted', clearanceReference: 'KSEF-1' }),
      );
      repo.findIssuedNonTerminal.mockResolvedValue({ items: [record], total: 1 });

      const result = await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result.updated).toBe(0);
      expect(result.scanned).toBe(1);
    });
  });

  describe('error handling (decision #8d / #8e)', () => {
    it('increments readErrors and continues the sweep when getClearanceStatus throws', async () => {
      const failing = makeRecord({ id: 'rec-fail', regulatoryStatus: 'submitted' });
      const ok = makeRecord({ id: 'rec-ok', regulatoryStatus: 'submitted' });
      const reader = readerAdapter((record) =>
        record.id === 'rec-fail'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ regulatoryStatus: 'accepted', clearanceReference: null }),
      );
      integrations.getCapabilityAdapter.mockResolvedValue(reader);
      repo.findIssuedNonTerminal.mockResolvedValue({ items: [failing, ok], total: 2 });

      const result = await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(result.readErrors).toBe(1);
      // The sweep continued and reconciled the second record.
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-ok', { regulatoryStatus: 'accepted' });
      expect(result.updated).toBe(1);
    });

    it('logs only connectionId + record.id + error.name / bounded message — never the raw provider string (8d)', async () => {
      const longSecret = 'X'.repeat(2000);
      const reader = readerAdapter(() => Promise.reject(new Error(longSecret)));
      integrations.getCapabilityAdapter.mockResolvedValue(reader);
      repo.findIssuedNonTerminal.mockResolvedValue({
        items: [makeRecord({ id: 'rec-secret', regulatoryStatus: 'submitted' })],
        total: 1,
      });

      const errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: (m: string) => void } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0];
      expect(logged).toContain(CONNECTION_ID);
      expect(logged).toContain('rec-secret');
      expect(logged).toContain('Error');
      // The raw, unbounded provider message must never reach the log sink.
      expect(logged).not.toContain(longSecret);
      expect(logged).toContain('…[truncated]');
    });

    it('returns normally (does not re-throw) when a per-record read throws, so nothing reaches the handler (8e)', async () => {
      const reader = readerAdapter(() => Promise.reject(new Error('provider down')));
      integrations.getCapabilityAdapter.mockResolvedValue(reader);
      repo.findIssuedNonTerminal.mockResolvedValue({
        items: [makeRecord({ regulatoryStatus: 'submitted' })],
        total: 1,
      });

      await expect(service.reconcile(CONNECTION_ID, { limit: 50 })).resolves.toMatchObject({
        readErrors: 1,
      });
    });
  });

  describe('keyset paging / tail coverage (decision #5, revised on #1206)', () => {
    it('walks the WHOLE non-terminal frontier within ONE run via the (updatedAt, id) cursor when total > limit', async () => {
      const reader = readerAdapter({ regulatoryStatus: 'accepted', clearanceReference: null });
      integrations.getCapabilityAdapter.mockResolvedValue(reader);

      // total=3, page size limit=1: the service must page three times within
      // the SAME run, carrying the (updatedAt, id) cursor forward, and reach the
      // tail (rec-c) — not just the oldest `limit` rows.
      const recA = makeRecord({ id: 'rec-a', updatedAt: new Date('2026-06-01T10:00:00Z') });
      const recB = makeRecord({ id: 'rec-b', updatedAt: new Date('2026-06-01T10:05:00Z') });
      const recC = makeRecord({ id: 'rec-c', updatedAt: new Date('2026-06-01T10:10:00Z') });
      repo.findIssuedNonTerminal
        .mockResolvedValueOnce({ items: [recA], total: 3 })
        .mockResolvedValueOnce({ items: [recB], total: 3 })
        .mockResolvedValueOnce({ items: [recC], total: 3 })
        // Frontier drained on the (terminal-already) follow-up page.
        .mockResolvedValueOnce({ items: [], total: 0 });

      const result = await service.reconcile(CONNECTION_ID, { limit: 1 });

      expect(result.total).toBe(3);
      expect(result.scanned).toBe(3);
      // The cursor advanced after each page (strictly after the last row).
      expect(repo.findIssuedNonTerminal).toHaveBeenNthCalledWith(1, CONNECTION_ID, {
        limit: 1,
        cursor: undefined,
      });
      expect(repo.findIssuedNonTerminal).toHaveBeenNthCalledWith(2, CONNECTION_ID, {
        limit: 1,
        cursor: { updatedAt: recA.updatedAt, id: 'rec-a' },
      });
      expect(repo.findIssuedNonTerminal).toHaveBeenNthCalledWith(3, CONNECTION_ID, {
        limit: 1,
        cursor: { updatedAt: recB.updatedAt, id: 'rec-b' },
      });
      // The TAIL row is reached and written — the bug this fix closes.
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-c', { regulatoryStatus: 'accepted' });
    });

    it('advances the cursor past a no-op-read row so the tail is reached even when the oldest rows never change (no starvation)', async () => {
      // rec-old reads back UNCHANGED (no updateOutcome, no updatedAt bump). Under
      // the old offset-0 walk it would pin the front every run and starve rec-new.
      // With the keyset cursor the next page is bounded strictly after rec-old.
      const recOld = makeRecord({
        id: 'rec-old',
        regulatoryStatus: 'submitted',
        clearanceReference: 'KSEF-STEADY',
        updatedAt: new Date('2026-06-01T09:00:00Z'),
      });
      const recNew = makeRecord({
        id: 'rec-new',
        regulatoryStatus: 'submitted',
        updatedAt: new Date('2026-06-01T11:00:00Z'),
      });
      const reader = readerAdapter((record) =>
        record.id === 'rec-old'
          ? Promise.resolve({ regulatoryStatus: 'submitted', clearanceReference: 'KSEF-STEADY' }) // no-op
          : Promise.resolve({ regulatoryStatus: 'accepted', clearanceReference: null }),
      );
      integrations.getCapabilityAdapter.mockResolvedValue(reader);
      repo.findIssuedNonTerminal
        .mockResolvedValueOnce({ items: [recOld], total: 2 })
        .mockResolvedValueOnce({ items: [recNew], total: 2 })
        .mockResolvedValueOnce({ items: [], total: 2 });

      const result = await service.reconcile(CONNECTION_ID, { limit: 1 });

      expect(result.scanned).toBe(2);
      // rec-old produced NO write (clean no-op) yet the cursor still advanced...
      expect(repo.findIssuedNonTerminal).toHaveBeenNthCalledWith(2, CONNECTION_ID, {
        limit: 1,
        cursor: { updatedAt: recOld.updatedAt, id: 'rec-old' },
      });
      // ...so the tail row was reached and reconciled within the same run.
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-new', { regulatoryStatus: 'accepted' });
    });
  });

  describe('idempotency', () => {
    it('a re-run with no upstream change is a clean no-op (no updateOutcome calls)', async () => {
      const record = makeRecord({ regulatoryStatus: 'submitted', clearanceReference: 'KSEF-9' });
      integrations.getCapabilityAdapter.mockResolvedValue(
        readerAdapter({ regulatoryStatus: 'submitted', clearanceReference: 'KSEF-9' }),
      );
      repo.findIssuedNonTerminal.mockResolvedValue({ items: [record], total: 1 });

      await service.reconcile(CONNECTION_ID, { limit: 50 });
      await service.reconcile(CONNECTION_ID, { limit: 50 });

      expect(repo.updateOutcome).not.toHaveBeenCalled();
    });
  });
});
