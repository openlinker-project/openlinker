/**
 * Attention-Reason Vocabulary (frontend mirror)
 *
 * The codes half of spec §4.2's inert states: the reason union, the badge
 * union, and the two per-reason facts the frontend reads — `badge` and
 * `counted`. Operator copy lives next door in `attention-reason.copy.ts`;
 * nothing in this file is rendered verbatim.
 *
 * ## Why this is a hand-maintained copy
 *
 * The authority is
 * `libs/core/src/fulfillment-authority/domain/types/authority-attention-reason.types.ts`.
 * The browser bundle cannot depend on `@openlinker/core` (#591), so this is a
 * copy — and a copy drifts silently in both directions. `scripts/check-attention-reason-mirror.mjs`
 * (in `pnpm check:invariants`) is the enforcement, not this comment.
 *
 * ## Why `badge` and `counted` are mirrored even though the API sends them
 *
 * `GET /connections/.../authority-status` carries `badge` per item and
 * pre-splits `counted` / `routine` — but that is the STATUS PAGE payload only.
 * The cross-surface row badges (#2356) read a row's `omsAttention`, whose
 * element type is `AuthorityAttentionEntry` (`producer`, `reason`, `detail?`,
 * `subjectRef?`, `since`) and carries **neither** field. An order / product /
 * return / connection row must therefore resolve reason -> badge -> tone
 * locally. This mirror is load-bearing for exactly the surfaces §4 exists for;
 * it is not duplication of the status payload.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 4.2 / § 4.3
 */

import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

/**
 * The eight inert states of spec §4.2, in the order that section tables them —
 * which is also the render order. Consumers iterate THIS array, never
 * `Object.keys` of a map keyed by it.
 *
 * One member per line, no computed keys and no spread: the mirror script reads
 * this array TEXTUALLY.
 *
 * AF-X is deliberately absent (per-firing lifecycle, owned by the automation
 * body, #2387). A ninth member is an ordinary addition: core, then this array,
 * then `ATTENTION_REASON_MIRROR`, then the copy map — the gate names each one
 * that is missing.
 */
export const AuthorityAttentionReasonValues = [
  'availability-unknown',
  'sourcing-ambiguous',
  'fulfillment-unaccepted',
  'line-unfulfillable',
  'reservation-shortfall',
  'returns-disposition-ambiguous',
  'restock-blocked',
  'return-unmatched',
] as const;

export type AuthorityAttentionReason = (typeof AuthorityAttentionReasonValues)[number];

/** Spec §4.2's closed four-value badge vocabulary, as codes. */
export const AuthorityAttentionBadgeValues = [
  'stopped',
  'at-risk',
  'blocked',
  'not-matched',
] as const;

export type AuthorityAttentionBadge = (typeof AuthorityAttentionBadgeValues)[number];

export interface AuthorityAttentionMirrorEntry {
  readonly badge: AuthorityAttentionBadge;
  readonly counted: boolean;
}

/**
 * The mirrored half of core's `AUTHORITY_ATTENTION_REASON_DESCRIPTORS`.
 *
 * Only the two fields the frontend reads. `specRow` / `surfaces` / `origin` /
 * `producer` / `equivalentAuthorityKind` are backend concerns delivered
 * already-resolved by the API — mirroring a field nothing here reads would be
 * maintenance with no guarantee behind it.
 */
export const ATTENTION_REASON_MIRROR = {
  'availability-unknown': { badge: 'stopped', counted: true },
  'sourcing-ambiguous': { badge: 'stopped', counted: true },
  'fulfillment-unaccepted': { badge: 'stopped', counted: true },
  'line-unfulfillable': { badge: 'at-risk', counted: true },
  'reservation-shortfall': { badge: 'at-risk', counted: true },
  'returns-disposition-ambiguous': { badge: 'stopped', counted: true },
  'restock-blocked': { badge: 'blocked', counted: true },
  'return-unmatched': { badge: 'not-matched', counted: true },
} satisfies Record<AuthorityAttentionReason, AuthorityAttentionMirrorEntry>;

/**
 * The aggregate-worthy subset — what a `Needs attention (N)` count and the
 * `?attention=` filter may include.
 *
 * DERIVED from the mirror, never hand-listed, exactly as core derives its own.
 * Every member is `counted` today, so this is the full list and the flag
 * discriminates nothing HERE — say so rather than let a reader assume
 * otherwise. §4.3's routine half lives on the who-decides ROW as an
 * `AuthorityState` / `AuthoritySource` / `AuthorityAnswer` (#2351) and is
 * structurally incapable of entering this union, which is why the A2-`none`
 * regression (#2356) cannot be counted.
 */
export const AuthorityAttentionCountedReasonValues: readonly AuthorityAttentionReason[] =
  AuthorityAttentionReasonValues.filter((reason) => ATTENTION_REASON_MIRROR[reason].counted);

/**
 * Narrow an untrusted string — a persisted value, a query param, a reason
 * written by a newer release and then rolled back.
 *
 * An unrecognised value renders neutrally and is NOT counted (spec §4.4 S2-5);
 * `ATTENTION_UNKNOWN_COPY` owns what that renders as.
 */
export function isAuthorityAttentionReason(value: unknown): value is AuthorityAttentionReason {
  return (
    typeof value === 'string' && (AuthorityAttentionReasonValues as readonly string[]).includes(value)
  );
}

/**
 * The `StatusBadge` tone a badge code renders in.
 *
 * Returns a subset of the shared primitive's own `StatusBadgeTone` — never an
 * invented union, or the badge renders untoned. §4.3's "badged danger/warning"
 * is design vocabulary; `error` / `warning` are the token names that exist.
 */
export function attentionBadgeTone(badge: AuthorityAttentionBadge): StatusBadgeTone {
  switch (badge) {
    case 'stopped':
      return 'error';
    case 'at-risk':
      return 'warning';
    case 'blocked':
      return 'error';
    case 'not-matched':
      return 'neutral';
  }
}
