import { describe, expect, it } from 'vitest';
import { formatPlural, loadMessages, messagesIn } from '../../../shared/i18n';
import type { SupportedLocale } from '../../../shared/i18n';
import type { BatchRun, BatchRunItem } from '../api/sales-document-batch.types';
import {
  type BatchCopyContext,
  describeItemDetail,
  describeItemOutcome,
  describeRunResult,
  describeRunStatus,
  formatElapsed,
  formatRunDuration,
  formatTimeUntil,
  summarizeRunItems,
} from './describe-batch-run';

const contextFor = (locale: SupportedLocale): BatchCopyContext => ({
  copy: messagesIn('sales-documents', locale).batch,
  plural: (count, forms, params) => formatPlural(count, forms, locale, params),
});

const EN = contextFor('en');

const run = (overrides: Partial<BatchRun> = {}): BatchRun => ({
  id: 'run-1',
  connectionId: 'conn-1',
  trigger: 'schedule',
  documentKinds: ['invoice'],
  segment: 'all',
  slotAt: null,
  status: 'completed',
  failureReason: null,
  eligibleCount: 10,
  enqueuedCount: 8,
  blockedCount: 2,
  startedAt: '2026-09-26T16:00:00.000Z',
  finishedAt: '2026-09-26T16:01:24.000Z',
  ...overrides,
});

const item = (overrides: Partial<BatchRunItem> = {}): BatchRunItem => ({
  orderId: 'order-1',
  documentKind: 'invoice',
  result: 'enqueued',
  outcome: 'issued',
  blockReason: null,
  orderNumber: 'ALG-1',
  buyerName: 'Anna Kowalska',
  documentNumber: 'FV/1/2026',
  ...overrides,
});

describe('describeRunStatus', () => {
  it('should flag a completed run with blocked orders as completed with issues', () => {
    expect(describeRunStatus(run(), EN)).toEqual({
      label: 'Completed with issues',
      tone: 'warning',
    });
    expect(describeRunStatus(run({ blockedCount: 0 }), EN)).toEqual({
      label: 'Completed',
      tone: 'success',
    });
  });

  it('should tell a healthy empty run apart from one that failed to start', () => {
    expect(describeRunStatus(run({ status: 'empty' }), EN).tone).toBe('neutral');
    expect(describeRunStatus(run({ status: 'failed-to-start' }), EN).tone).toBe('error');
  });
});

describe('describeRunResult', () => {
  it('should say what the run sent to issue, never that it issued', () => {
    expect(describeRunResult(run(), EN)).toBe('8 sent to issue · 2 blocked');
  });

  it('should name why a run failed to start', () => {
    expect(
      describeRunResult(
        run({ status: 'failed-to-start', failureReason: 'connection-needs-reauth' }),
        EN
      )
    ).toBe('connection needs reconnecting');
  });

  it('should count orders that were neither sent nor blocked', () => {
    expect(describeRunResult(run({ eligibleCount: 11 }), EN)).toBe(
      '8 sent to issue · 2 blocked · 1 not issued'
    );
  });
});

describe('durations', () => {
  it('should format a finished run as hh:mm:ss and an open one as absent', () => {
    expect(formatRunDuration(run())).toBe('00:01:24');
    expect(formatRunDuration(run({ finishedAt: null }))).toBeNull();
    expect(formatElapsed(3_723_000)).toBe('01:02:03');
  });

  it('should count down to a future slot and say due once it passed', () => {
    const now = new Date('2026-09-26T12:48:00.000Z');
    expect(formatTimeUntil('2026-09-26T16:00:00.000Z', now, EN)).toBe('in 3 h 12 min');
    expect(formatTimeUntil('2026-09-26T12:00:00.000Z', now, EN)).toBe('due now');
  });
});

describe('item outcome and detail', () => {
  it('should show the document number of an issued order', () => {
    expect(describeItemOutcome(item(), EN)).toEqual({ label: 'Issued', tone: 'success' });
    expect(describeItemDetail(item(), 'eparagony.pl', EN)).toBe('FV/1/2026');
  });

  it('should explain in-doubt as safe to retry', () => {
    const detail = describeItemDetail(item({ outcome: 'in-doubt' }), 'eparagony.pl', EN);
    expect(detail).toContain('eparagony.pl did not answer in time');
    expect(detail).toContain('cannot create a duplicate');
  });

  it('should explain a blocked order with the gate reason copy', () => {
    const detail = describeItemDetail(
      item({ result: 'blocked', outcome: 'blocked', blockReason: 'missing-tax-rate' }),
      'eparagony.pl',
      EN
    );
    expect(detail).toContain('no tax rate');
  });

  it('should say an order already documented elsewhere was not issued again', () => {
    expect(
      describeItemDetail(item({ result: 'already-documented', outcome: 'blocked' }), 'x', EN)
    ).toBe('Already has a document on another connection.');
  });
});

describe('Polish copy', () => {
  it('should use the Polish plural forms for the run result', async () => {
    await loadMessages('pl');
    const PL = contextFor('pl');
    expect(
      describeRunResult(run({ eligibleCount: 9, enqueuedCount: 5, blockedCount: 2 }), PL)
    ).toBe('5 wysłanych do wystawienia · 2 zablokowane · 2 niewystawione');
    expect(describeItemOutcome(item(), PL).label).toBe('Wystawiono');
  });
});

describe('summarizeRunItems', () => {
  it('should split issued, blocked and needs attention', () => {
    expect(
      summarizeRunItems([
        item(),
        item({ outcome: 'blocked' }),
        item({ outcome: 'skipped' }),
        item({ outcome: 'in-doubt' }),
        item({ outcome: 'failed' }),
        item({ outcome: 'pending' }),
      ])
    ).toEqual({ issued: 1, blocked: 2, attention: 2, pending: 1 });
  });
});
