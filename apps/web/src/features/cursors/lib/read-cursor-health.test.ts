/**
 * readCursorHealth / readCursorProgress tests (#4024)
 */
import { describe, expect, it } from 'vitest';
import type { CursorOverviewItem } from '../api/cursors.types';
import { messagesIn } from '../../../shared/i18n';
import { readCursorHealth, readCursorProgress } from './read-cursor-health';
import { buildSyncProgressCopy } from './sync-progress-copy';

const C = buildSyncProgressCopy(messagesIn('cursors', 'en'), 'en');

const NOW = Date.parse('2026-11-06T10:00:00Z');
const ago = (iso: string): string => `${Math.round((NOW - Date.parse(iso)) / 60_000)} min ago`;
const when = (iso: string): string => iso;
const minutesAgo = (m: number): string => new Date(NOW - m * 60_000).toISOString();

function item(over: Partial<CursorOverviewItem>): CursorOverviewItem {
  return {
    cursorKey: 'allegro.orders.lastEventId',
    value: '42',
    createdAt: minutesAgo(1000),
    updatedAt: minutesAgo(2),
    family: 'event-bookmark',
    rewind: null,
    lastRun: null,
    ...over,
  };
}

describe('readCursorHealth', () => {
  it('should read On time when the cursor moved within two intervals', () => {
    expect(
      readCursorHealth(item({ updatedAt: minutesAgo(9) }), 'allegro', NOW, ago, when, C).id
    ).toBe('ok');
  });

  it('should read Late when the cursor moved between two and six intervals ago', () => {
    expect(
      readCursorHealth(item({ updatedAt: minutesAgo(20) }), 'allegro', NOW, ago, when, C).id
    ).toBe('late');
  });

  it('should read Not moving when the cursor has not moved for more than six intervals', () => {
    expect(
      readCursorHealth(item({ updatedAt: minutesAgo(31) }), 'allegro', NOW, ago, when, C).id
    ).toBe('stuck');
  });

  it('should read On time when a finished catalogue pass sits empty however old it is', () => {
    const pass = item({
      cursorKey: 'master.product.sweep:connection:c1',
      family: 'sweep-cycle',
      value: '',
      updatedAt: minutesAgo(500),
    });
    expect(readCursorHealth(pass, 'prestashop', NOW, ago, when, C).id).toBe('ok');
  });

  it('should read Failing with the error when the last run is dead', () => {
    const failing = item({
      lastRun: {
        jobId: 'j',
        jobType: 'marketplace.orders.poll',
        status: 'dead',
        outcome: null,
        at: minutesAgo(1),
        lastError: '401 Unauthorized\nstack',
      },
    });
    const health = readCursorHealth(failing, 'allegro', NOW, ago, when, C);
    expect(health.id).toBe('failing');
    expect(health.why).toContain('401 Unauthorized');
    expect(health.why).not.toContain('stack');
  });

  it('should read Wrong connection when the key names another platform', () => {
    expect(readCursorHealth(item({}), 'shopify', NOW, ago, when, C).id).toBe('misplaced');
  });

  it('should read OK when the cursor has no schedule of its own', () => {
    const mark = item({
      cursorKey: 'inventory.offerQuantity.observedAt:offer:1',
      family: 'write-order',
      updatedAt: minutesAgo(9000),
    });
    expect(readCursorHealth(mark, 'allegro', NOW, ago, when, C).id).toBe('plain');
  });
});

describe('readCursorProgress', () => {
  it('should say the pass finished when a catalogue cursor is empty', () => {
    const p = readCursorProgress(
      item({ family: 'sweep-cycle', value: '' }),
      minutesAgo(13),
      ago,
      when,
      C
    );
    expect(p.main).toBe('Finished, waiting for next pass');
    expect(p.sub).toBe('Last pass done 13 min ago');
  });

  it('should say how far an open pass got when the cursor holds a cycle and an offset', () => {
    const p = readCursorProgress(
      item({ family: 'sweep-cycle', value: '7f3a-91c2:1200' }),
      null,
      ago,
      when,
      C
    );
    expect(p.main).toBe('In progress: 1,200 items done');
    expect(p.parsedPass).toEqual({ cycleId: '7f3a-91c2', offset: 1200 });
  });

  it('should say not started when a non-catalogue cursor is empty', () => {
    expect(readCursorProgress(item({ value: '' }), null, ago, when, C).main).toBe(
      'Not started yet'
    );
  });

  it('should describe a feed cursor by when it moved, never by its raw value', () => {
    const p = readCursorProgress(item({ value: '2198437710533118' }), null, ago, when, C);
    expect(p.main).not.toContain('2198437710533118');
  });
});
