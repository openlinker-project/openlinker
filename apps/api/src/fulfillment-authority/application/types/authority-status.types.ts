/**
 * Authority Status Types (#2353)
 *
 * The shapes the "Who decides what" surface reads: the seven resolved rows, the
 * inert states split counted-vs-routine, and a preset's before/after diff.
 *
 * @module apps/api/src/fulfillment-authority/application/types
 */
import type {
  AuthorityAnswerView,
  AuthorityAttentionBadge,
  AuthorityAttentionOrigin,
  AuthorityAttentionReason,
  AuthorityAttentionSurface,
  AuthorityQuestion,
} from '@openlinker/core/fulfillment-authority';
import type {
  AuthorityPresetId,
  AuthorityPresetUnavailableReason,
} from '../authority-presets';

/**
 * One inert state, as the surface renders it.
 *
 * `surfaces` is a LIST and is not the same question as where the state
 * originates: A1-U originates on a connection's configuration and renders on the
 * PRODUCT rows whose publishing is paused. The descriptor table answers both;
 * this type carries the answer rather than letting each consumer re-derive it.
 */
export interface AuthorityAttentionItemView {
  readonly reason: AuthorityAttentionReason;
  readonly badge: AuthorityAttentionBadge;
  readonly surfaces: readonly AuthorityAttentionSurface[];
  readonly origin: AuthorityAttentionOrigin;
  /** The who-decides row this state was derived FROM, or `null` for a persisted one. */
  readonly question: AuthorityQuestion | null;
  /**
   * The connections whose competing claims produced it — what #2355 names in the
   * blocked-save message and what #2356 badges the connection card with. Empty
   * for a persisted state, whose subject is a work object rather than a connection.
   */
  readonly connectionIds: readonly string[];
}

export interface AuthorityAttentionView {
  /**
   * The attention-worthy states — counted, toned and filterable (§4.3).
   *
   * DERIVED here, on every read, from the ambiguous rows; never stored. A
   * `Connection.config` ambiguity is a pure function of config, and a persisted
   * copy would be a second answer with a staleness window (#2352).
   */
  readonly counted: readonly AuthorityAttentionItemView[];
  /**
   * The routine half — shown on its row, never counted.
   *
   * **Always empty today**, and that is correct rather than broken: every member
   * of the union is `counted: true`, and §4.3's routine states (a default answer,
   * "nothing to route", a compound answer, an observation) live on the who-decides
   * ROW as an `AuthorityState` / `AuthoritySource` / `AuthorityAnswer` and are
   * structurally incapable of entering this union. The field is present so a
   * member opted out later needs no shape change, and so no consumer invents a
   * client-side split — which would be the two-independent-lists failure §4.3
   * exists to prevent.
   */
  readonly routine: readonly AuthorityAttentionItemView[];
  /**
   * Orders carrying at least one counted PERSISTED state (#2352).
   *
   * Separate from `counted`, which is the derived half. Adding the two is the
   * caller's job because they count different things: `counted` counts STATES
   * (one per ambiguous authority, install-wide), this counts ORDERS.
   */
  readonly affectedOrderCount: number;
}

export interface AuthorityPresetView {
  readonly id: AuthorityPresetId;
  readonly available: boolean;
  readonly unavailableReason: AuthorityPresetUnavailableReason | null;
}

/**
 * Which connections an apply actually wrote.
 *
 * Present only on the apply response. The write is N independent full-row
 * saves across what may be several plugins' config-shape validators, so it
 * cannot be made atomic here — this reports the partial outcome instead of
 * pretending otherwise. Re-applying the same preset converges (the mutation is
 * idempotent), which is what makes a reported failure recoverable rather than a
 * state the operator has to repair by hand.
 */
export interface AuthorityPresetApplyReport {
  readonly updatedConnectionIds: readonly string[];
  readonly failedConnectionIds: readonly string[];
}

export interface AuthorityStatusView {
  /** Exactly seven, in `AuthorityQuestionValues` order, each with an answer AND a why. */
  readonly rows: readonly AuthorityAnswerView[];
  readonly attention: AuthorityAttentionView;
  readonly presets: readonly AuthorityPresetView[];
  /** Present only on an apply response; absent on a plain status read. */
  readonly applied?: AuthorityPresetApplyReport;
}

/** One row whose answer the preset would change. */
export interface AuthorityPresetChange {
  readonly question: AuthorityQuestion;
  readonly before: AuthorityAnswerView;
  readonly after: AuthorityAnswerView;
}

export interface AuthorityPresetPreview {
  readonly presetId: AuthorityPresetId;
  /**
   * Exactly the rows that change, so #2355 can generate its sentences from the
   * diff rather than from static copy. Empty is a legitimate answer and means
   * "this changes nothing" — which is card 1's whole content.
   */
  readonly changes: readonly AuthorityPresetChange[];
  /**
   * The ambiguities the RESULT would carry. Non-empty means the apply will be
   * refused, and each entry names the connections to link to.
   *
   * Computed from the resulting resolution, not from the delta: an install that
   * is ALREADY ambiguous is refused by every preset including the no-op, which
   * is what story S1-4 asks for ("would result in any authority resolving
   * ambiguous").
   */
  readonly resultingAmbiguities: readonly AuthorityAttentionItemView[];
  /** `resultingAmbiguities.length > 0`, shipped so no consumer re-derives it. */
  readonly blocked: boolean;
}
