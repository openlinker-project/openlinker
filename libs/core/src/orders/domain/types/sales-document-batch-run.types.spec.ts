/**
 * Batch run pure rules (#3583)
 *
 * @module libs/core/src/orders/domain/types
 */
import type { SalesDocumentRecordView } from '@openlinker/core/sales-documents';
import {
  buildManualBatchRunKey,
  buildScheduledBatchRunKey,
  deriveBatchItemOutcome,
  isBatchQueueB2b,
} from './sales-document-batch-run.types';

const doc = (status: string, failureMode: string | null = null): SalesDocumentRecordView =>
  ({ status, failureMode }) as unknown as SalesDocumentRecordView;

describe('deriveBatchItemOutcome', () => {
  it.each([
    ['blocked', null, 'blocked'],
    ['already-documented', null, 'blocked'],
    ['not-routed-here', null, 'skipped'],
    ['indeterminate', null, 'needs-attention'],
    ['enqueued', null, 'pending'],
    ['enqueued', doc('issued'), 'issued'],
    ['enqueued', doc('registered'), 'issued'],
    ['enqueued', doc('issuing'), 'pending'],
    ['enqueued', doc('failed', 'in-doubt'), 'in-doubt'],
    ['enqueued', doc('failed', 'rejected'), 'failed'],
  ] as const)('should map %s with %o to %s', (result, document, outcome) => {
    expect(deriveBatchItemOutcome(result, document)).toBe(outcome);
  });
});

describe('isBatchQueueB2b (D42)', () => {
  it('should treat only an asserted tax id as B2B', () => {
    expect(isBatchQueueB2b('5213796333')).toBe(true);
    expect(isBatchQueueB2b('')).toBe(false); // asserted none
    expect(isBatchQueueB2b(null)).toBe(false); // unknown - issued daily, never stranded
  });
});

describe('batch run keys', () => {
  it('should give the same slot the same key whatever the kind order', () => {
    const slotAt = new Date('2026-01-31T22:00:00Z');
    const a = buildScheduledBatchRunKey({
      connectionId: 'c',
      documentKinds: ['invoice', 'fiscal-receipt'],
      segment: 'all',
      slotAt,
    });
    const b = buildScheduledBatchRunKey({
      connectionId: 'c',
      documentKinds: ['fiscal-receipt', 'invoice'],
      segment: 'all',
      slotAt,
    });
    expect(a).toBe(b);
    expect(a).toBe('salesDocument:batch:c:all:fiscal-receipt+invoice:2026-01-31T22:00:00.000Z');
  });

  it('should keep a manual run apart from every slot', () => {
    expect(buildManualBatchRunKey('c', 'req-1')).toBe('salesDocument:batch:c:manual:req-1');
  });
});
