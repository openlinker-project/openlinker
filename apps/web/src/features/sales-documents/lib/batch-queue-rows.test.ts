import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { messagesIn } from '../../../shared/i18n';
import type { BatchQueueEntry, BatchRunItem } from '../api/sales-document-batch.types';
import {
  buildBatchQueueRows,
  countBatchQueueRows,
  describeRunNowError,
  filterBatchQueueRows,
} from './batch-queue-rows';

const entry = (orderId: string, documentKind = 'invoice'): BatchQueueEntry => ({
  orderId,
  sourceConnectionId: 'src',
  documentKind,
  placedAt: null,
  totalAmount: 10,
  currency: 'PLN',
  isB2b: false,
  orderNumber: orderId.toUpperCase(),
  buyerName: null,
});

const item = (orderId: string, result: string): BatchRunItem => ({
  orderId,
  documentKind: 'invoice',
  result,
  outcome: result === 'enqueued' ? 'issued' : 'blocked',
  blockReason: null,
  orderNumber: null,
  buyerName: null,
  documentNumber: null,
});

describe('buildBatchQueueRows', () => {
  it('should list queued orders and add the last run refusals as blocked', () => {
    const rows = buildBatchQueueRows(
      [entry('a'), entry('b', 'fiscal-receipt')],
      [item('x', 'enqueued'), item('y', 'already-documented')]
    );

    expect(rows.map((row) => `${row.kind}:${row.orderId}`)).toEqual([
      'queued:a',
      'queued:b',
      'blocked:y',
    ]);
  });

  it('should show an order still queued after an indeterminate run once, as blocked', () => {
    const rows = buildBatchQueueRows([entry('a')], [item('a', 'indeterminate')]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'blocked', orderId: 'a' });
  });
});

describe('filtering and counts', () => {
  const rows = buildBatchQueueRows(
    [entry('a'), entry('b', 'fiscal-receipt'), entry('c')],
    [item('y', 'blocked')]
  );

  it('should count every chip', () => {
    expect(countBatchQueueRows(rows)).toEqual({
      all: 4,
      invoice: 2,
      'fiscal-receipt': 1,
      blocked: 1,
    });
  });

  it('should filter by kind and by blocked', () => {
    expect(filterBatchQueueRows(rows, 'invoice').map((row) => row.orderId)).toEqual(['a', 'c']);
    expect(filterBatchQueueRows(rows, 'blocked').map((row) => row.orderId)).toEqual(['y']);
    expect(filterBatchQueueRows(rows, 'all')).toHaveLength(4);
  });
});

const COPY = messagesIn('sales-documents', 'en').batch;

describe('describeRunNowError', () => {
  it('should word a refusal code', () => {
    const error = new ApiError('conflict', 409, { code: 'BATCH_RUN_IN_PROGRESS' });
    expect(describeRunNowError(error, COPY)).toBe(
      'A batch run is already in progress. Wait for it to finish.'
    );
  });

  it('should fall back to the error message for an unknown failure', () => {
    expect(describeRunNowError(new Error('Network down'), COPY)).toBe('Network down');
  });
});
