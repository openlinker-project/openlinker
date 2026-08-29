/**
 * Authority Status Types (frontend view of the #2353 wire contract)
 *
 * Codes only. Every field the API sends is a CODE — operator copy is the
 * frontend's and lives in `../lib/who-decides.copy.ts`, because a backend
 * string could never pass `check-ui-vocabulary` and could never enter the
 * frontend's translation seam.
 *
 * These unions mirror `libs/core/src/fulfillment-authority/domain/types/` and
 * `apps/api/src/fulfillment-authority/application/authority-presets.ts`. The
 * browser bundle cannot depend on `@openlinker/core` (#591), so they are
 * copies. Only `AuthorityKindValues` carries a build-enforced mirror
 * (`scripts/check-authority-kind-mirror.mjs`, whose declared path is this
 * feature's `lib/authority-kind.ts`); the rest are guarded by the runtime
 * parse in `who-decides.schema.ts`, which drops an unreadable response
 * rather than rendering a value this build does not understand.
 *
 * @module apps/web/src/features/fulfillment-authority/api
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 3.3
 */

/** The seven rows of spec § 3.3, in the order the table renders them. */
export const AuthorityQuestionValues = [
  'availability',
  'sourcing',
  'fulfillment-execution',
  'order-lifecycle',
  'returns-disposition',
  'refund-trigger',
  'sales-documents',
] as const;

export type AuthorityQuestion = (typeof AuthorityQuestionValues)[number];

/**
 * How well resolved a row is.
 *
 * Derived by ONE producer in core from `(source, answer.kind)`. A surface
 * renders it and never re-derives it — the #2100 `blocksIssuanceElsewhere`
 * rule.
 */
export const AuthorityStateValues = ['resolved', 'default', 'ambiguous', 'unavailable'] as const;

export type AuthorityState = (typeof AuthorityStateValues)[number];

/**
 * By what means the answer was reached.
 *
 * Distinct from `state`, which says how well resolved. THIS is what a surface
 * tests to render the A6 "always" and A7 "elsewhere" treatments — a question
 * literal in the browser would be a second copy of a rule that lives in core.
 */
export const AuthoritySourceValues = [
  'default',
  'operator-config',
  'fixed-by-design',
  'delegated',
] as const;

export type AuthoritySource = (typeof AuthoritySourceValues)[number];

export const AuthorityAnswerKindValues = [
  'openlinker',
  'holders',
  'manual',
  'default-today',
  'nobody-to-route',
  'cannot-tell',
  'configured-elsewhere',
] as const;

export type AuthorityAnswerKind = (typeof AuthorityAnswerKindValues)[number];

export const AuthorityAmbiguityReasonValues = [
  'no-primary',
  'multiple-primaries',
  'multiple-claimants-same-scope',
] as const;

export type AuthorityAmbiguityReason = (typeof AuthorityAmbiguityReasonValues)[number];

export const AuthorityDefaultWhyCodeValues = [
  'a1-computed-from-master-minus-buffer',
  'a1-claimed-by-connection',
  'a2-single-origin-nothing-to-choose',
  'a2-claimed-by-connection',
  'a3-lands-where-it-does-today',
  'a3-claimed-by-connection',
  'a4-derived-from-observed-facts',
  'a4-claimed-by-connection',
  'a5-nothing-decides-yet-handled-by-hand',
  'a5-claimed-by-connection',
  'a6-only-ol-holds-payment-credentials',
  'a7-configured-under-sales-documents',
] as const;

export type AuthorityDefaultWhyCode = (typeof AuthorityDefaultWhyCodeValues)[number];

/** One party deciding one thing over one scope. */
export interface AuthorityAnswerParty {
  readonly connectionId: string;
  readonly scopeKind: string;
}

/**
 * What answers the question.
 *
 * `holders` carries one OR MANY entries — several systems handling different
 * orders is a description of a normal setup, and is structurally distinct from
 * `cannot-tell`, which means two of them claim the SAME thing.
 */
export type AuthorityAnswer =
  | { readonly kind: 'openlinker' }
  | { readonly kind: 'holders'; readonly parties: readonly AuthorityAnswerParty[] }
  | { readonly kind: 'manual' }
  | { readonly kind: 'default-today' }
  | { readonly kind: 'nobody-to-route' }
  | {
      readonly kind: 'cannot-tell';
      readonly reason: AuthorityAmbiguityReason;
      readonly candidateConnectionIds: readonly string[];
    }
  | { readonly kind: 'configured-elsewhere'; readonly surface: string };

/**
 * Two arms, not one flat list.
 *
 * An ambiguous row's why-line is REPLACED by the matching § 4.2 body copy
 * rather than qualified by it (spec § 3.3), so the surface has to tell the two
 * apart mechanically. A flat union would make that a string-prefix convention.
 */
export type AuthorityWhy =
  /**
   * `code` is a plain `string`, not the union below.
   *
   * The union is a hand-copy of core's (#591 forbids importing it), so a release
   * that adds a why-code reaches a browser still running the old bundle during
   * every rolling deploy. Parsed as a closed enum, one unrecognised code failed
   * the WHOLE-envelope parse: seven rows and every preset replaced by an error
   * state, and `useOmsAttentionQuery` degrading silently so the `/connections`
   * and `/products` badges vanished too. A code this build cannot name is a
   * one-LINE degradation instead — `WHY_CODE_FALLBACK` says so on that row and
   * every other row still renders its own answer.
   */
  | { readonly kind: 'default'; readonly code: string }
  | { readonly kind: 'ambiguous'; readonly reason: AuthorityAmbiguityReason };

/** One rendered row of the table. */
export interface AuthorityAnswerRow {
  readonly question: AuthorityQuestion;
  readonly state: AuthorityState;
  readonly answer: AuthorityAnswer;
  readonly why: AuthorityWhy;
  readonly source: AuthoritySource;
  /**
   * Connections claiming this that are switched off, and so were never
   * eligible. Reported so the page can say so; never changes the answer.
   */
  readonly inactiveClaimantConnectionIds: readonly string[];
}

/**
 * The closed badge vocabulary of spec § 3.3, as codes.
 *
 * `not-available` is unreachable today and is deliberately its own member
 * rather than folded into `chosen` — see `resolveRowBadge`.
 */
export const AuthorityRowBadgeValues = [
  'default',
  'nothing-to-route',
  'always',
  'elsewhere',
  'chosen',
  'nothing-is-deciding',
  'not-available',
] as const;

export type AuthorityRowBadge = (typeof AuthorityRowBadgeValues)[number];

/** One inert state, as the status payload reports it. */
export interface AuthorityAttentionItem {
  readonly reason: string;
  readonly badge: string;
  readonly surfaces: readonly string[];
  readonly origin: string;
  /** The row this state was derived FROM, or `null` for a persisted one. */
  readonly question: AuthorityQuestion | null;
  readonly connectionIds: readonly string[];
}

export interface AuthorityAttention {
  readonly counted: readonly AuthorityAttentionItem[];
  /**
   * ALWAYS EMPTY today, and correct rather than broken — the API's own
   * description says so. § 4.3's routine states live on the who-decides ROW as
   * a state / source / answer instead. Never invent a client-side split.
   */
  readonly routine: readonly AuthorityAttentionItem[];
  readonly affectedOrderCount: number;
}

export const AuthorityPresetIdValues = [
  'leave-as-they-are',
  'openlinker-decides',
  'keep-other-system',
] as const;

export type AuthorityPresetId = (typeof AuthorityPresetIdValues)[number];

export const AuthorityPresetUnavailableReasonValues = [
  'needs-a-system-that-can-take-over',
] as const;

export type AuthorityPresetUnavailableReason =
  (typeof AuthorityPresetUnavailableReasonValues)[number];

export interface AuthorityPreset {
  readonly id: AuthorityPresetId;
  readonly available: boolean;
  /**
   * A code, present exactly when `available` is false. A plain `string` for the
   * same skew reason as {@link AuthorityWhy}'s `code`: an unrecognised reason
   * renders `PRESET_UNAVAILABLE_REASON_FALLBACK` on that one card rather than
   * costing the operator the whole page.
   */
  readonly unavailableReason: string | null;
}

/**
 * Which connections an apply actually wrote.
 *
 * Present only on an apply response. A non-empty `failedConnectionIds` means
 * the arrangement is PARTIALLY applied — the write is N independent saves and
 * cannot be atomic. Re-submitting the same choice converges.
 */
export interface AuthorityPresetApplyReport {
  readonly updatedConnectionIds: readonly string[];
  readonly failedConnectionIds: readonly string[];
}

export interface AuthorityStatus {
  /** Exactly seven, in `AuthorityQuestionValues` order, each with an answer AND a why. */
  readonly rows: readonly AuthorityAnswerRow[];
  readonly attention: AuthorityAttention;
  readonly presets: readonly AuthorityPreset[];
  /** Present only on an apply response; absent on a plain read. */
  readonly applied: AuthorityPresetApplyReport | null;
}

/**
 * One row whose answer a preset would change.
 *
 * `before` / `after` are full rows, so the confirm dialog renders them through
 * the same `resolveAnswer` the table uses instead of growing a second answer
 * renderer.
 */
export interface AuthorityPresetChange {
  readonly question: AuthorityQuestion;
  readonly before: AuthorityAnswerRow;
  readonly after: AuthorityAnswerRow;
}

/**
 * What a preset would do — computed by the server, never in the browser.
 *
 * A client-side diff would have to reimplement resolution and would drift from
 * it; the endpoint exists so the dialog's sentences are generated from the
 * server's own answer.
 */
export interface AuthorityPresetPreview {
  readonly presetId: AuthorityPresetId;
  /** Exactly the rows that change. **Empty is a legitimate answer** — it means nothing changes. */
  readonly changes: readonly AuthorityPresetChange[];
  /**
   * The ambiguities the RESULT would carry. Computed from the resulting
   * resolution, not the delta — so an install that is ALREADY contradictory is
   * reported even by the option that changes nothing.
   */
  readonly resultingAmbiguities: readonly AuthorityAttentionItem[];
  /** `resultingAmbiguities.length > 0`, shipped so no consumer re-derives it. */
  readonly blocked: boolean;
}

/** Narrow an untrusted string to a question. */
export function isAuthorityQuestion(value: unknown): value is AuthorityQuestion {
  return typeof value === 'string' && (AuthorityQuestionValues as readonly string[]).includes(value);
}

/** Narrow an untrusted string to a preset id. */
export function isAuthorityPresetId(value: unknown): value is AuthorityPresetId {
  return typeof value === 'string' && (AuthorityPresetIdValues as readonly string[]).includes(value);
}
