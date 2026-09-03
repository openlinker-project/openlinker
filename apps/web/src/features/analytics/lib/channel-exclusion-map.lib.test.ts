import { describe, expect, it } from 'vitest';
import { buildChannelExclusionMap } from './channel-exclusion-map.lib';
import type { AnalyticsCoverageByConnection } from '../api/analytics-coverage.types';

describe('buildChannelExclusionMap (#2714)', () => {
  it('returns an empty map for undefined input (never-loaded state)', () => {
    const map = buildChannelExclusionMap(undefined);

    expect(map.size).toBe(0);
  });

  it('returns an empty map when every category has an empty rows array (all-clear)', () => {
    const byConnection: AnalyticsCoverageByConnection = {
      categories: [
        { category: 'currency', rows: [] },
        { category: 'tax-a', rows: [] },
        { category: 'tax-b', rows: [] },
        { category: 'tax-c', rows: [] },
      ],
    };

    const map = buildChannelExclusionMap(byConnection);

    expect(map.size).toBe(0);
  });

  it('groups multiple connections under the same category, keeping each connection distinct', () => {
    const byConnection: AnalyticsCoverageByConnection = {
      categories: [
        {
          category: 'currency',
          rows: [
            { sourceConnectionId: 'conn-a', affectedCount: 3 },
            { sourceConnectionId: 'conn-b', affectedCount: 1 },
          ],
        },
        { category: 'tax-a', rows: [] },
        { category: 'tax-b', rows: [] },
        { category: 'tax-c', rows: [] },
      ],
    };

    const map = buildChannelExclusionMap(byConnection);

    expect(map.get('conn-a')?.get('currency')).toBe(3);
    expect(map.get('conn-b')?.get('currency')).toBe(1);
    expect(map.size).toBe(2);
  });

  it('attributes each category to the connection it actually belongs to, never mixing them', () => {
    const byConnection: AnalyticsCoverageByConnection = {
      categories: [
        { category: 'currency', rows: [{ sourceConnectionId: 'conn-a', affectedCount: 1 }] },
        { category: 'tax-a', rows: [] },
        { category: 'tax-b', rows: [{ sourceConnectionId: 'conn-b', affectedCount: 1 }] },
        { category: 'tax-c', rows: [] },
      ],
    };

    const map = buildChannelExclusionMap(byConnection);

    expect(map.get('conn-a')?.size).toBe(1);
    expect(map.get('conn-a')?.has('currency')).toBe(true);
    expect(map.get('conn-a')?.has('tax-b')).toBe(false);

    expect(map.get('conn-b')?.size).toBe(1);
    expect(map.get('conn-b')?.has('tax-b')).toBe(true);
    expect(map.get('conn-b')?.has('currency')).toBe(false);
  });

  it('carries the count through verbatim, since grouping already happened server-side', () => {
    const byConnection: AnalyticsCoverageByConnection = {
      categories: [
        { category: 'currency', rows: [{ sourceConnectionId: 'conn-a', affectedCount: 42 }] },
        { category: 'tax-a', rows: [] },
        { category: 'tax-b', rows: [] },
        { category: 'tax-c', rows: [] },
      ],
    };

    const map = buildChannelExclusionMap(byConnection);

    expect(map.get('conn-a')?.get('currency')).toBe(42);
  });
});
