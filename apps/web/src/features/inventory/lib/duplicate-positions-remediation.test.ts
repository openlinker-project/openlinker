/**
 * duplicate-positions-remediation tests (#3264 review)
 *
 * Covers `liveExposureQuantity`'s stale-exclusion, `findSurvivorId`'s
 * newest-live-row rule and its all-stale `null`, `reservationRiskRows`, and
 * `buildRemediationDeleteSql` — including the all-stale fallback, which no
 * test previously reached.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRemediationDeleteSql,
  findSurvivorId,
  liveExposureQuantity,
  reservationRiskRows,
} from './duplicate-positions-remediation';
import type { DuplicatePositionGroup, DuplicatePositionRow } from '../api/inventory.types';

function buildRow(overrides: Partial<DuplicatePositionRow> = {}): DuplicatePositionRow {
  return {
    id: 'ol_inventory_row1',
    availableQuantity: 1,
    reservedQuantity: 0,
    isStale: false,
    updatedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

function buildGroup(overrides: Partial<DuplicatePositionGroup> = {}): DuplicatePositionGroup {
  return {
    productId: 'ol_product_a1',
    productVariantId: null,
    locationId: null,
    sourceConnectionId: null,
    rowCount: 0,
    liveRowCount: 0,
    productName: null,
    sku: null,
    connectionName: null,
    locationName: null,
    rows: [],
    ...overrides,
  };
}

describe('liveExposureQuantity', () => {
  it('should sum availableQuantity across LIVE rows only', () => {
    const group = buildGroup({
      rows: [
        buildRow({ id: 'r1', availableQuantity: 20, isStale: false }),
        buildRow({ id: 'r2', availableQuantity: 3, isStale: false }),
        buildRow({ id: 'r3', availableQuantity: 100, isStale: true }),
      ],
    });

    // 23, never 123 — a naive sum-everything implementation fails this.
    expect(liveExposureQuantity(group)).toBe(23);
  });

  it('should return 0 when every row is stale', () => {
    const group = buildGroup({
      rows: [buildRow({ availableQuantity: 50, isStale: true })],
    });
    expect(liveExposureQuantity(group)).toBe(0);
  });
});

describe('findSurvivorId', () => {
  it('should pick the first non-stale row (rows arrive newest-first)', () => {
    const group = buildGroup({
      rows: [
        buildRow({ id: 'stale-newest', isStale: true }),
        buildRow({ id: 'live-next', isStale: false }),
        buildRow({ id: 'live-oldest', isStale: false }),
      ],
    });
    expect(findSurvivorId(group)).toBe('live-next');
  });

  it('should return null when every row is stale', () => {
    const group = buildGroup({
      rows: [buildRow({ id: 'r1', isStale: true }), buildRow({ id: 'r2', isStale: true })],
    });
    expect(findSurvivorId(group)).toBeNull();
  });
});

describe('reservationRiskRows', () => {
  it('should exclude the survivor even if it holds a reservation', () => {
    const group = buildGroup({
      rows: [
        buildRow({ id: 'survivor', isStale: false, reservedQuantity: 5 }),
        buildRow({ id: 'loser-with-reservation', isStale: true, reservedQuantity: 2 }),
        buildRow({ id: 'loser-no-reservation', isStale: true, reservedQuantity: 0 }),
      ],
    });

    const risky = reservationRiskRows(group, 'survivor');
    expect(risky.map((r) => r.id)).toEqual(['loser-with-reservation']);
  });
});

describe('buildRemediationDeleteSql', () => {
  it('should keep the newest live row and delete the rest', () => {
    const group = buildGroup({
      rows: [
        buildRow({ id: 'survivor', isStale: false }),
        buildRow({ id: 'loser1', isStale: false }),
        buildRow({ id: 'loser2', isStale: true }),
      ],
    });

    const result = buildRemediationDeleteSql(group);
    expect(result.survivor?.id).toBe('survivor');
    expect(result.losers.map((r) => r.id)).toEqual(['loser1', 'loser2']);
    expect(result.sql).toContain("'loser1'");
    expect(result.sql).toContain("'loser2'");
    expect(result.sql).not.toContain("'survivor'");
  });

  it('should fall back to the newest row when every row is stale (runbook step 2)', () => {
    const group = buildGroup({
      rows: [
        buildRow({ id: 'newest-stale', isStale: true, updatedAt: '2026-09-14T00:00:00.000Z' }),
        buildRow({ id: 'oldest-stale', isStale: true, updatedAt: '2026-09-13T00:00:00.000Z' }),
      ],
    });

    // Composed via findSurvivorId (which returns null here) ?? rows[0] — the
    // fallback this test targets, which no other test reached.
    const result = buildRemediationDeleteSql(group);
    expect(result.survivor?.id).toBe('newest-stale');
    expect(result.losers.map((r) => r.id)).toEqual(['oldest-stale']);
    expect(result.sql).toContain("'oldest-stale'");
    expect(result.sql).not.toContain("'newest-stale'");
  });

  it('should return a null sql and empty losers for a group with no rows', () => {
    const group = buildGroup({ rows: [] });
    const result = buildRemediationDeleteSql(group);
    expect(result.survivor).toBeNull();
    expect(result.losers).toEqual([]);
    expect(result.sql).toBeNull();
  });

  it('should generate a primary-key-only DELETE against inventory_items', () => {
    const group = buildGroup({
      rows: [buildRow({ id: 'survivor', isStale: false }), buildRow({ id: 'loser', isStale: true })],
    });

    const result = buildRemediationDeleteSql(group);
    expect(result.sql).toBe('DELETE FROM "inventory_items"\n WHERE "id" IN (\'loser\');');
  });
});
