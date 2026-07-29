import { describe, expect, it } from 'vitest';
import { deriveEventGroups } from './derive-event-groups';

describe('deriveEventGroups', () => {
  it('returns an empty list for an empty catalog', () => {
    expect(deriveEventGroups({})).toEqual([]);
  });

  it('returns the distinct groups in first-seen order', () => {
    const catalog = {
      event_a: { group: 'exploration' },
      event_b: { group: 'conversion-intent' },
      event_c: { group: 'exploration' },
    };

    expect(deriveEventGroups(catalog)).toEqual(['exploration', 'conversion-intent']);
  });

  it('picks up a new group added to the catalog with no code change', () => {
    const catalogV1 = { event_a: { group: 'exploration' } };
    const catalogV2 = {
      event_a: { group: 'exploration' },
      event_b: { group: 'new-group' },
    };

    expect(deriveEventGroups(catalogV1)).toEqual(['exploration']);
    expect(deriveEventGroups(catalogV2)).toEqual(['exploration', 'new-group']);
  });
});
