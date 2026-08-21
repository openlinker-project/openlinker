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
});
