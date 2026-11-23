/**
 * Mirakl Offer Write Reconciler: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { MiraklOfferWrite } from '../../../domain/entities/mirakl-offer-write.entity';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import type { MiraklOfferWriteRepositoryPort } from '../../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklImportStatus } from '../../../domain/types/mirakl-import.types';
import type { MiraklOfferWriteKind } from '../../../domain/types/mirakl-offer-write.types';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { IMiraklImportTracker } from '../../imports/mirakl-import-tracker.interface';
import { MiraklOfferWriteReconciler } from '../mirakl-offer-write-reconciler';

const NOW = new Date('2026-11-23T12:00:00.000Z');

function write(
  kind: MiraklOfferWriteKind,
  sku: string,
  value: string,
  version = 1
): MiraklOfferWrite {
  return new MiraklOfferWrite(
    `id-${sku}`,
    'conn-1',
    kind,
    sku,
    value,
    null,
    'pending',
    null,
    version,
    null,
    NOW,
    NOW
  );
}

function status(overrides: Partial<MiraklImportStatus>): MiraklImportStatus {
  return {
    kind: 'stock',
    importId: 'imp-1',
    state: 'done',
    rawStatus: 'COMPLETE',
    hasErrorReport: false,
    ...overrides,
  };
}

interface Harness {
  reconciler: MiraklOfferWriteReconciler;
  store: jest.Mocked<MiraklOfferWriteRepositoryPort>;
  tracker: jest.Mocked<IMiraklImportTracker>;
  postFile: jest.Mock;
}

function setup(pending: Partial<Record<MiraklOfferWriteKind, MiraklOfferWrite[]>> = {}): Harness {
  const store = {
    recordPending: jest.fn(),
    findPending: jest.fn((_c: string, kind: MiraklOfferWriteKind) =>
      Promise.resolve(pending[kind] ?? [])
    ),
    markSubmitted: jest.fn((writes: readonly MiraklOfferWrite[]) => Promise.resolve(writes.length)),
    failPending: jest.fn().mockResolvedValue(0),
    findSubmittedImports: jest.fn().mockResolvedValue([]),
    settleImport: jest.fn().mockResolvedValue(1),
    failImport: jest.fn().mockResolvedValue(1),
    deleteSettledBefore: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<MiraklOfferWriteRepositoryPort>;
  const tracker = {
    getStatus: jest.fn(),
    getErrorReport: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<IMiraklImportTracker>;
  const postFile = jest.fn().mockResolvedValue({ status: 201, data: { import_id: 'imp-9' } });
  const reconciler = new MiraklOfferWriteReconciler(
    'conn-1',
    { postFile } as unknown as IMiraklHttpClient,
    tracker,
    store,
    () => NOW
  );
  return { reconciler, store, tracker, postFile };
}

describe('MiraklOfferWriteReconciler send', () => {
  it('should send all pending stock as one STO01 file and mark it submitted', async () => {
    const pending = [write('stock', 'SKU-1', '3'), write('stock', 'SKU-2', '0')];
    const { reconciler, store, postFile } = setup({ stock: pending });

    const result = await reconciler.reconcile(50);

    expect(postFile).toHaveBeenCalledTimes(1);
    expect(postFile).toHaveBeenCalledWith(
      '/api/offers/stock/imports',
      expect.objectContaining({
        fieldName: 'file',
        contentType: 'text/csv',
        content: 'offer-sku;quantity\nSKU-1;3\nSKU-2;0\n',
      })
    );
    expect(store.markSubmitted).toHaveBeenCalledWith(pending, 'imp-9');
    expect(result).toEqual({ reconciled: 0, stillPending: 2 });
  });

  it('should send prices through PRI01, never through OF24', async () => {
    const { reconciler, postFile } = setup({ price: [write('price', 'SKU-1', '44.99')] });

    await reconciler.reconcile(50);

    expect(postFile).toHaveBeenCalledWith(
      '/api/offers/pricing/imports',
      expect.objectContaining({ content: 'offer-sku;price\nSKU-1;44.99\n' })
    );
    expect(postFile.mock.calls.map((call: unknown[]) => call[0] as string)).not.toContain('/api/offers');
  });

  it('should send nothing when nothing is pending', async () => {
    const { reconciler, postFile } = setup();

    await reconciler.reconcile(50);

    expect(postFile).not.toHaveBeenCalled();
  });

  it('should fail changes whose file Mirakl refuses, instead of resending them forever', async () => {
    const pending = [write('stock', 'SKU-1', '3')];
    const { reconciler, store, postFile } = setup({ stock: pending });
    postFile.mockRejectedValueOnce(new MiraklApiException('bad file', 400));

    await reconciler.reconcile(50);

    expect(store.failPending).toHaveBeenCalledWith(pending, expect.stringContaining('(400)'));
    expect(store.markSubmitted).not.toHaveBeenCalled();
  });
});

describe('MiraklOfferWriteReconciler settle', () => {
  it('should apply an import that finished without errors', async () => {
    const { reconciler, store, tracker } = setup();
    store.findSubmittedImports.mockResolvedValue([{ importId: 'imp-1', kind: 'stock' }]);
    tracker.getStatus.mockResolvedValue(status({ linesInError: 0 }));

    const result = await reconciler.reconcile(50);

    expect(tracker.getStatus).toHaveBeenCalledWith('stock', 'imp-1');
    expect(store.settleImport).toHaveBeenCalledWith('conn-1', 'imp-1', new Map());
    expect(result.reconciled).toBe(1);
  });

  it('should fail the lines a COMPLETE import reports in error', async () => {
    const { reconciler, store, tracker } = setup();
    store.findSubmittedImports.mockResolvedValue([{ importId: 'imp-1', kind: 'stock' }]);
    tracker.getStatus.mockResolvedValue(status({ linesInError: 1, hasErrorReport: true }));
    tracker.getErrorReport.mockResolvedValue([
      { line: 2, sku: 'SKU-1', reason: 'Offer not found' },
    ]);

    await reconciler.reconcile(50);

    expect(store.settleImport).toHaveBeenCalledWith(
      'conn-1',
      'imp-1',
      new Map([['SKU-1', 'Offer not found']])
    );
  });

  it('should fail the whole import when an error line names no SKU', async () => {
    const { reconciler, store, tracker } = setup();
    store.findSubmittedImports.mockResolvedValue([{ importId: 'imp-1', kind: 'price' }]);
    tracker.getStatus.mockResolvedValue(status({ kind: 'prices', linesInError: 1 }));
    tracker.getErrorReport.mockResolvedValue([{ line: 2, reason: 'Invalid price' }]);

    await reconciler.reconcile(50);

    expect(tracker.getStatus).toHaveBeenCalledWith('prices', 'imp-1');
    expect(store.failImport).toHaveBeenCalledWith('conn-1', 'imp-1', 'Invalid price');
    expect(store.settleImport).not.toHaveBeenCalled();
  });

  it('should fail every line of an import Mirakl failed', async () => {
    const { reconciler, store, tracker } = setup();
    store.findSubmittedImports.mockResolvedValue([{ importId: 'imp-1', kind: 'stock' }]);
    tracker.getStatus.mockResolvedValue(status({ state: 'failed', rawStatus: 'FAILED' }));

    await reconciler.reconcile(50);

    expect(store.failImport).toHaveBeenCalledWith(
      'conn-1',
      'imp-1',
      expect.stringContaining('FAILED')
    );
  });

  it('should leave a running import for the next pass, and not let an unreadable one block the rest', async () => {
    const { reconciler, store, tracker } = setup();
    store.findSubmittedImports.mockResolvedValue([
      { importId: 'imp-1', kind: 'stock' },
      { importId: 'imp-2', kind: 'stock' },
      { importId: 'imp-3', kind: 'stock' },
    ]);
    tracker.getStatus
      .mockResolvedValueOnce(status({ state: 'pending', rawStatus: 'RUNNING' }))
      .mockRejectedValueOnce(new MiraklApiException('gone', 404))
      .mockResolvedValueOnce(status({ importId: 'imp-3' }));

    const result = await reconciler.reconcile(50);

    expect(result).toEqual({ reconciled: 1, stillPending: 2 });
    expect(store.settleImport).toHaveBeenCalledWith('conn-1', 'imp-3', new Map());
  });

  it('should prune settled rows older than a week', async () => {
    const { reconciler, store } = setup();

    await reconciler.reconcile(50);

    expect(store.deleteSettledBefore).toHaveBeenCalledWith(
      'conn-1',
      new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
    );
  });
});
