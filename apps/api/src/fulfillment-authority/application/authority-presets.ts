/**
 * Authority Presets (#2353, Wave-2 product spec §3.2)
 *
 * The three cards of the "Who decides what" page, as the config mutation each
 * one produces. **This file is the single place a preset's semantics live**: the
 * service, the controller and every DTO are written against the catalogue, so
 * adding, enabling or changing a preset is an edit here and nowhere else.
 *
 * ## The mutation is DISABLE, never DELETE
 *
 * `openlinker-decides` sets `enabled: false` on every assignable claim and
 * preserves everything else about it — the connection it sits on, its `scopes`,
 * its `isPrimary`. That is the whole design of the card: the operator's
 * warehouse assignment survives, so the change is reversible by re-enabling, and
 * a preset switch is never a silent deletion of configuration the operator
 * cannot reconstruct. A destructive preset would also make the confirm dialog
 * (#2355) a lie — it promises to show what changes, and it cannot show the
 * restoration of something that no longer exists.
 *
 * ## A6 is never touched
 *
 * Refund authority never leaves OpenLinker (ADR-056), so `refund-trigger` is
 * excluded from the loop rather than merely being harmless to write: rewriting the
 * key would imply the claim had ever been honoured. Note the key is only READABLE,
 * not reported — the A6 row is `fixed-by-design` and its
 * `inactiveClaimantConnectionIds` is hardcoded empty, so no surface tells an
 * operator that their claim was ignored. Enforcement is right; surfacing the
 * ignored claim is not built. A7 cannot appear at all — its question
 * carries `kind: null` and is answered by `sales-documents`.
 *
 * ## Pure, and non-mutating by construction
 *
 * Every path builds a new object with spreads and never assigns into its
 * argument, which is what makes the in-memory PREVIEW safe: preview runs exactly
 * this function against the live configs and diffs the result, so a mutation
 * here would corrupt the caller's connections while merely "previewing".
 * A spec pins that against a deep-frozen input rather than trusting inspection.
 *
 * ## Re-enabling restores exactly what was there
 *
 * Because nothing is deleted, the operator-facing claim *"you can change your
 * mind"* is TRUE rather than aspirational, and #2357's copy may say so: setting
 * `enabled: true` again on the same key restores the same connection, the same
 * `scopes` and the same `isPrimary`. Any future preset that DELETES a key
 * silently falsifies that sentence on a page the operator has already read.
 *
 * ## Read this before landing another mutating preset's write path
 *
 * `ConnectionService.update` is a read-modify-write full-row `save()`. Applying a
 * preset therefore races an operator editing the same connection in another tab,
 * last-writer-wins. Acceptable for a settings page an operator drives by hand and
 * confirms first; it stops being acceptable the moment anything applies a preset
 * without a human present, and the fix then is a narrow conditional update, not a
 * retry.
 *
 * @module apps/api/src/fulfillment-authority/application
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §3.2
 */
import {
  AUTHORITY_KIND_DESCRIPTORS,
  AuthorityKindValues,
  parseAuthorityConfig,
} from '@openlinker/core/fulfillment-authority';
import type { ConnectionConfig } from '@openlinker/core/identifier-mapping';

/**
 * The three cards, in the order §3.2 renders them.
 *
 * One member per line and no computed keys — the repo's mirror scripts read
 * these arrays textually, and #2357's will read this one.
 */
export const AuthorityPresetIdValues = [
  /** Card 1 — the pre-preset state. Writes nothing, by definition. */
  'leave-as-they-are',
  /** Card 2 — every assignable claim disabled, every assignment preserved. */
  'openlinker-decides',
  /** Card 3 — hand a claim to an external system. Wave-4 gated. */
  'keep-other-system',
] as const;

export type AuthorityPresetId = (typeof AuthorityPresetIdValues)[number];

/**
 * Why a preset cannot be chosen, as a CODE.
 *
 * Core-style codes rather than English for the same reason `resolveAuthorities`
 * emits why-CODES: operator copy that originated in the backend bypasses
 * `check-ui-vocabulary`, can never enter the frontend's `t(key, fallback)` seam,
 * and would make #2354's own copy-gate criterion unsatisfiable. #2357 owns the
 * words.
 */
export const AuthorityPresetUnavailableReasonValues = [
  /** Needs a system that can take over; none can be assigned until Wave 4. */
  'needs-a-system-that-can-take-over',
] as const;

export type AuthorityPresetUnavailableReason =
  (typeof AuthorityPresetUnavailableReasonValues)[number];

export interface AuthorityPresetDefinition {
  /**
   * Whether the operator may choose it. An unavailable preset is RETURNED with
   * its reason rather than omitted (#2353 AC): hiding it would leave the
   * operator unable to see the shape of the choice, and it is the same
   * discipline as #2170's disabled tax-id checkbox.
   */
  readonly available: boolean;
  /** Present iff `available` is false — asserted in the spec. */
  readonly unavailableReason: AuthorityPresetUnavailableReason | null;
  /**
   * The config this preset would leave on one connection.
   *
   * MUST return the argument itself when it changes nothing: the caller uses
   * reference identity to decide whether a connection needs writing at all, so a
   * gratuitous copy would write every connection on every apply.
   */
  readonly mutate: (config: ConnectionConfig) => ConnectionConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Identity — card 1 changes nothing, so it returns the very same reference. */
function keepAsIs(config: ConnectionConfig): ConnectionConfig {
  return config;
}

/**
 * Disable every assignable claim while preserving which connection held it.
 *
 * Only a claim `parseAuthorityConfig` reads as ENABLED is touched. Going through
 * the coercer rather than testing the raw value is what keeps this honest about
 * the zero-ceremony form: a bare `true` is a claim and becomes `{ enabled: false }`,
 * while a malformed or absent value is already unheld and is left byte-identical
 * rather than being "normalised" into a config the operator never wrote.
 */
function disableClaimsPreservingAssignment(config: ConnectionConfig): ConnectionConfig {
  let next = config;
  for (const kind of AuthorityKindValues) {
    // ADR-056 — refund authority is not assignable, so it is not revocable either.
    if (kind === 'refund-trigger') {
      continue;
    }
    if (!parseAuthorityConfig(config, kind).enabled) {
      continue;
    }
    const key = AUTHORITY_KIND_DESCRIPTORS[kind].configKey;
    const raw = (config as Record<string, unknown>)[key];
    const preserved = isRecord(raw) ? { ...raw } : {};
    next = { ...next, [key]: { ...preserved, enabled: false } };
  }
  return next;
}

/** One entry per `AuthorityPresetId`, in the same order. */
export const AUTHORITY_PRESETS: Readonly<Record<AuthorityPresetId, AuthorityPresetDefinition>> =
  Object.freeze({
    'leave-as-they-are': Object.freeze({
      available: true,
      unavailableReason: null,
      mutate: keepAsIs,
    }),
    'openlinker-decides': Object.freeze({
      available: true,
      unavailableReason: null,
      mutate: disableClaimsPreservingAssignment,
    }),
    'keep-other-system': Object.freeze({
      // Wave-4 gated: the fact-producer seam an external system would need does
      // not exist, so an apply could only write a claim nothing can honour.
      available: false,
      unavailableReason: 'needs-a-system-that-can-take-over' as const,
      mutate: keepAsIs,
    }),
  });

/** Narrow an untrusted string (a request body, a query param) to a preset id. */
export function isAuthorityPresetId(value: unknown): value is AuthorityPresetId {
  return (
    typeof value === 'string' && (AuthorityPresetIdValues as readonly string[]).includes(value)
  );
}
