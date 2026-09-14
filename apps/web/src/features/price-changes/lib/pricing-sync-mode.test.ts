import { describe, expect, it } from 'vitest';
import { anyConnectionAutomatic } from './pricing-sync-mode';
import type { ConnectionPricingSyncView } from '../api/pricing-sync.types';

function view(overrides: Partial<ConnectionPricingSyncView> = {}): ConnectionPricingSyncView {
  return {
    default: { mode: 'manual', rule: { type: 'passthrough', percent: 0, rounding: 'none' } },
    sources: [],
    ...overrides,
  };
}

describe('anyConnectionAutomatic', () => {
  it('returns false when every summary is manual', () => {
    expect(anyConnectionAutomatic([view(), view()])).toBe(false);
  });

  it('returns true when a default mode is automatic', () => {
    expect(
      anyConnectionAutomatic([view({ default: { mode: 'automatic', rule: view().default.rule } })]),
    ).toBe(true);
  });

  it('returns true when a source override is automatic even if the default is manual', () => {
    expect(
      anyConnectionAutomatic([
        view({
          sources: [
            {
              sourceConnectionId: 'src-1',
              sourceLabel: 'Supplier',
              isCustomOverride: true,
              effective: { mode: 'automatic', rule: { type: 'passthrough', percent: 0, rounding: 'none' } },
              openEpisodeCount: 0,
            },
          ],
        }),
      ]),
    ).toBe(true);
  });

  it('treats an unresolved (undefined) summary as not automatic rather than throwing', () => {
    expect(anyConnectionAutomatic([undefined, view()])).toBe(false);
  });
});
