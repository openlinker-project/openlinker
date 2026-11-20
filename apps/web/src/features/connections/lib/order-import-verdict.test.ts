import { describe, expect, it } from 'vitest';
import type { OrderImportStatus } from '../api/connections.types';
import { deriveOrderImportVerdict } from './order-import-verdict';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const figures = (overrides: Partial<OrderImportStatus> = {}): OrderImportStatus => ({
  importedLast24h: 5,
  lastPolledAt: '2026-11-20T11:50:00.000Z',
  failedLast7d: 0,
  failures: [],
  waiting: 0,
  lastImportedAt: null,
  activeImport: null,
  ...overrides,
});

describe('deriveOrderImportVerdict', () => {
  it('should be unknown when the figures could not be read, never fine', () => {
    expect(deriveOrderImportVerdict(null, NOW)).toBe('unknown');
  });

  it('should put failing orders ahead of a stale poll', () => {
    expect(
      deriveOrderImportVerdict(
        figures({ failedLast7d: 2, lastPolledAt: '2026-11-18T00:00:00.000Z' }),
        NOW,
      ),
    ).toBe('failing');
  });

  it('should say not checked when the shop was never polled successfully', () => {
    expect(deriveOrderImportVerdict(figures({ lastPolledAt: null }), NOW)).toBe('notChecked');
  });

  it('should say behind once the shop has not been checked for over an hour', () => {
    expect(
      deriveOrderImportVerdict(figures({ lastPolledAt: '2026-11-20T10:30:00.000Z' }), NOW),
    ).toBe('behind');
  });

  it('should say ok for a recent check with nothing failing', () => {
    expect(deriveOrderImportVerdict(figures(), NOW)).toBe('ok');
  });
});
