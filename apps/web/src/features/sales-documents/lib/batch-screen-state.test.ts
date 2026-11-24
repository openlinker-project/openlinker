import { describe, expect, it } from 'vitest';
import { resolveBatchScreenState } from './batch-screen-state';

const base = { tab: 'queue' as const, unavailable: false, running: false, queueIsEmpty: false };

describe('resolveBatchScreenState', () => {
  it('should name each M15 state', () => {
    expect(resolveBatchScreenState({ ...base, tab: 'schedule' })).toBe('settings');
    expect(resolveBatchScreenState(base)).toBe('queue');
    expect(resolveBatchScreenState({ ...base, running: true })).toBe('running');
    expect(resolveBatchScreenState({ ...base, queueIsEmpty: true })).toBe('empty');
    expect(resolveBatchScreenState({ ...base, tab: 'history' })).toBe('finished');
  });

  it('should report unavailable whatever tab is open', () => {
    expect(resolveBatchScreenState({ ...base, tab: 'schedule', unavailable: true })).toBe(
      'unavailable'
    );
    expect(resolveBatchScreenState({ ...base, running: true, unavailable: true })).toBe(
      'unavailable'
    );
  });
});
