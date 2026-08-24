/**
 * Order Lifecycle Phase — the vocabulary alone (#2310)
 *
 * The nine-value derived lifecycle phase (#2305, ADR-059) as a **types-only
 * module**: the values, the union, and the coercion guard. Nothing here imports
 * a component, so the transport layer can name the phase without reaching into
 * the UI.
 *
 * **Split out of `order-lifecycle-phase.ts` by #2441 review S10.** That file
 * imports `StatusBadgeTone` from `shared/ui/status-badge`, and
 * `api/orders.types.ts` — the wire-shape module — imports the phase type from
 * it, so the API-shape module transitively named a component module. The import
 * was type-only and therefore erased, so no runtime edge existed and no
 * documented rule was broken; the split removes the smell before something in
 * that lib stops being type-only and the edge becomes real. Label, tone and
 * operator copy stay in `order-lifecycle-phase.ts`, which re-exports everything
 * here so existing consumers are unaffected.
 *
 * **`OrderLifecyclePhaseValues` below is a hand mirror of
 * `OrderLifecyclePhaseValues` in `libs/core/src/order-lifecycle/domain/types/
 * order-lifecycle-phase.types.ts` — same exported name, same nine literals, same
 * precedence order.** The order is contract, not presentation (it is the ordinal
 * the derivation and the SQL `CASE` both read). What #2311's mirror check
 * compares is the sequence of literals: its parser slices between the brackets
 * and scans the quoted values, so it is **line-agnostic** — a prettier reformat
 * onto one line is survivable and needs no `prettier-ignore`. Keep the ORDER,
 * and do not nest the array, rename it or move this file without updating
 * `scripts/check-order-lifecycle-phase-mirror.mjs` in the same commit.
 *
 * @module apps/web/src/features/orders/lib
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 */

/**
 * The nine phases, in the backend's precedence order (highest first).
 *
 * Hand-mirrored from core per the FE-001 contract strategy. #2311 enforces the
 * byte-equality of this declaration against core's.
 */
export const OrderLifecyclePhaseValues = [
  'cancelled',
  'vendor_authoritative',
  'delivered',
  'in_transit',
  'fulfillment_failed',
  'held',
  'amending',
  'blocked',
  'ready',
] as const;

export type OrderLifecyclePhaseValue = (typeof OrderLifecyclePhaseValues)[number];

/**
 * Coerce an untrusted value — a URL search param, a field on an older payload —
 * to the union. Deliberately no fallback, matching core's `isOrderLifecyclePhase`:
 * there is no phase safe to assume, and defaulting an unknown value to `ready`
 * would report "nothing to do" about an order in an unknown state.
 */
export function isOrderLifecyclePhase(value: unknown): value is OrderLifecyclePhaseValue {
  return (
    typeof value === 'string' && (OrderLifecyclePhaseValues as readonly string[]).includes(value)
  );
}
