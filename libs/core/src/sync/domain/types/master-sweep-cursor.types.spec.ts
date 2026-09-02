/**
 * Master Sweep Cursor Keys Spec
 *
 * Pins the exact key strings: the worker handler/e2e specs hard-code the same
 * literals independently, so a format change here fails both suites instead of
 * silently splitting reader and writer onto different keys.
 *
 * @module domain/types
 */

import {
  MasterSweepKindValues,
  masterSweepCursorKey,
  masterSweepCompletedAtCursorKey,
  masterSweepRemainingCountCursorKey,
} from './master-sweep-cursor.types';

describe('master sweep cursor keys', () => {
  it('should build the sweep cursor key byte-identical to the worker format', () => {
    expect(masterSweepCursorKey('product-reconcile', 'conn-1')).toBe(
      'master.product-reconcile.sweep:connection:conn-1'
    );
    expect(masterSweepCursorKey('product', 'abc')).toBe('master.product.sweep:connection:abc');
    expect(masterSweepCursorKey('inventory', 'abc')).toBe('master.inventory.sweep:connection:abc');
    expect(masterSweepCursorKey('product-delta', 'abc')).toBe(
      'master.product-delta.sweep:connection:abc'
    );
    // Built for completeness — the #2317 backfill never PERSISTS this key,
    // because its predicate is its cursor. See the union's docblock.
    expect(masterSweepCursorKey('inventory-provenance', 'abc')).toBe(
      'master.inventory-provenance.sweep:connection:abc'
    );
  });

  it('should build a completedAt key distinct from the sweep cursor key for every kind', () => {
    for (const kind of MasterSweepKindValues) {
      expect(masterSweepCompletedAtCursorKey(kind, 'conn-1')).toBe(
        `master.${kind}.completedAt:connection:conn-1`
      );
      expect(masterSweepCompletedAtCursorKey(kind, 'conn-1')).not.toBe(
        masterSweepCursorKey(kind, 'conn-1')
      );
    }
  });

  it('should build a remainingNull key distinct from both other keys for every kind', () => {
    for (const kind of MasterSweepKindValues) {
      expect(masterSweepRemainingCountCursorKey(kind, 'conn-1')).toBe(
        `master.${kind}.remainingNull:connection:conn-1`
      );
      expect(masterSweepRemainingCountCursorKey(kind, 'conn-1')).not.toBe(
        masterSweepCursorKey(kind, 'conn-1')
      );
      expect(masterSweepRemainingCountCursorKey(kind, 'conn-1')).not.toBe(
        masterSweepCompletedAtCursorKey(kind, 'conn-1')
      );
    }
  });

  it('should pin the two keys the #2317 backfill actually persists', () => {
    // Hard-coded independently of the builders: the worker handler spec and the
    // e2e int-spec assert the same literals, and #2325 reads them. A format
    // change must fail here rather than silently split reader from writer.
    expect(masterSweepCompletedAtCursorKey('inventory-provenance', 'sys')).toBe(
      'master.inventory-provenance.completedAt:connection:sys'
    );
    expect(masterSweepRemainingCountCursorKey('inventory-provenance', 'sys')).toBe(
      'master.inventory-provenance.remainingNull:connection:sys'
    );
  });
});
