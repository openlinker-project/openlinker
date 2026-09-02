/**
 * Order Lifecycle Phase — mirror + copy tests (#2310)
 *
 * Covers the three things the maps can get wrong without a compiler noticing:
 * an empty label, a missing "waiting on" line, and operator copy that leaks
 * OpenLinker's internal design vocabulary (REVIEW P9). The exhaustive `Record`
 * types already catch an OMITTED key at compile time; these catch a present-but-
 * useless one.
 *
 * @module apps/web/src/features/orders/lib
 */
import { describe, expect, it } from 'vitest';

import {
  ORDER_LIFECYCLE_PHASE_META,
  ORDER_LIFECYCLE_PHASE_WAITING_ON,
  OrderLifecyclePhaseValues,
  isOrderLifecyclePhase,
  phaseBadge,
} from './order-lifecycle-phase';

describe('order lifecycle phase mirror', () => {
  it('should declare the nine phases in the backend precedence order', () => {
    expect([...OrderLifecyclePhaseValues]).toEqual([
      'cancelled',
      'vendor_authoritative',
      'delivered',
      'in_transit',
      'fulfillment_failed',
      'held',
      'amending',
      'blocked',
      'ready',
    ]);
  });

  it.each(OrderLifecyclePhaseValues)('should carry a label and tone for %s', (phase) => {
    const meta = ORDER_LIFECYCLE_PHASE_META[phase];
    expect(meta.label.trim().length).toBeGreaterThan(0);
    // #2081 — badge labels stay short enough not to wrap on a table row.
    expect(meta.label.length).toBeLessThanOrEqual(17);
    expect(meta.tone).toBeTruthy();
  });

  it.each(OrderLifecyclePhaseValues)('should carry a waiting-on line for %s', (phase) => {
    expect(ORDER_LIFECYCLE_PHASE_WAITING_ON[phase].trim().length).toBeGreaterThan(0);
  });

  it('should keep OpenLinker design vocabulary out of every operator-facing string', () => {
    const internalVocabulary = /authority|posture|fulfillmentwork/i;
    for (const phase of OrderLifecyclePhaseValues) {
      expect(ORDER_LIFECYCLE_PHASE_META[phase].label).not.toMatch(internalVocabulary);
      expect(ORDER_LIFECYCLE_PHASE_WAITING_ON[phase]).not.toMatch(internalVocabulary);
    }
  });
});

describe('isOrderLifecyclePhase', () => {
  it.each(OrderLifecyclePhaseValues)('should accept the known phase %s', (phase) => {
    expect(isOrderLifecyclePhase(phase)).toBe(true);
  });

  it('should reject an unknown value, null and a non-string', () => {
    expect(isOrderLifecyclePhase('returned')).toBe(false);
    expect(isOrderLifecyclePhase(null)).toBe(false);
    expect(isOrderLifecyclePhase(undefined)).toBe(false);
    expect(isOrderLifecyclePhase(3)).toBe(false);
  });
});

describe('phaseBadge', () => {
  it.each(OrderLifecyclePhaseValues)('should always resolve a badge for %s', (phase) => {
    // Every KNOWN phase renders, including the three the Shipment column also
    // describes — an absent badge must mean "old payload", nothing else.
    expect(phaseBadge(phase)).not.toBeNull();
  });

  it('should return null only for an absent or unrecognised phase', () => {
    expect(phaseBadge(undefined)).toBeNull();
    expect(phaseBadge(null)).toBeNull();
    expect(phaseBadge('not_a_phase')).toBeNull();
  });

  it('should render a vendor label verbatim with an attribution', () => {
    const badge = phaseBadge('vendor_authoritative', 'Oczekuje na odbiór');
    expect(badge?.label).toBe('Oczekuje na odbiór');
    expect(badge?.attribution).toBe('reported by the sales channel');
  });

  it('should fall back to the OpenLinker label when no vendor label is supplied', () => {
    const badge = phaseBadge('vendor_authoritative');
    expect(badge?.label).toBe('Channel status');
    expect(badge?.attribution).toBeUndefined();
  });

  it('should ignore a vendor label on any other phase', () => {
    const badge = phaseBadge('blocked', 'Oczekuje na odbiór');
    expect(badge?.label).toBe('Blocked');
    expect(badge?.attribution).toBeUndefined();
  });
});
