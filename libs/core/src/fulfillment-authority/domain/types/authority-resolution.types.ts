/**
 * Authority Resolution Read Model (#2351, ADR-052 / ADR-053 / ADR-056)
 *
 * The first thing in the programme that computes an *answer*. #2304 shipped the
 * vocabulary with no production caller; this is what turns an operator's
 * `Connection.config` claim into the seven rows of Wave-2 product spec §3.3.
 *
 * ## This output may render, may inform, and may NEVER gate a write
 *
 * That rule is the reason this read model may live in the leaf at all. ADR-053
 * places *enforcement* resolution in the context that owns each write (A1 in
 * `inventory`, A5 in `returns`, …). This is not enforcement — it is a read model
 * over the same pure inputs, feeding one surface that spans all seven rows, and
 * placing it in any single owning context would force that context to import
 * five siblings.
 *
 * The distinction only holds while nothing acts on the output. A write path that
 * consumed `resolveAuthorities` would quietly become the *second* answer to a
 * question an owning context already answers — precisely what ADR-053 exists to
 * prevent. A write path needs its own context's resolution. Stated here rather
 * than assumed because it is cheap now and unrecoverable once three call sites
 * exist.
 *
 * **One carve-out, and its boundary is the whole of it: a REFUSAL over the
 * resolved result is permitted; a DECISION derived from it is not.** #2353's
 * `applyPreset` re-runs `resolveAuthorities` over the configs it is about to
 * write and returns 422 if any row comes back `ambiguous`, writing nothing. That
 * is the sole instance, and it is admissible because it decides nothing — it
 * declines, leaving the operator to choose, which is exactly ADR-052's rule that
 * ambiguity is inert and reported rather than resolved arbitrarily. A consumer
 * that read a `holders` answer and *acted* on it would be the forbidden thing,
 * however narrow the action. Deleting the #2353 guard on the strength of the
 * paragraph above would let an install carrying two claimants persist an
 * ambiguous preset silently; widening it into a decision would breach ADR-053.
 *
 * ## Pure, total, and structural
 *
 * No I/O, not async, constructs no adapter, never throws, never mutates its
 * argument. R1 finding G6 deleted `getAuthorityScopes()` from the port for
 * exactly this reason — selection stays lazy-compatible and infallible. Every
 * input arrives as a plain argument, which is also what makes #2353's in-memory
 * preset *preview* possible: mutate a copy of the configs, re-run, diff.
 *
 * The leaf carries an EMPTY cross-context allow-set (`barrel-purity.spec.ts`) —
 * stricter than every other context, and not even a type-only `Connection`
 * import is permitted. `AuthorityClaimantInput` is therefore structural, and
 * carries no `platformType` at all, so capability-driven resolution is not a
 * rule to remember but a shape that cannot express the alternative.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 * @see docs/plans/implementation-plan-authority-resolution-read-model.md
 */

import { AUTHORITY_KIND_DESCRIPTORS, type AuthorityKind } from './authority-kind.types';
import { parseAuthorityConfig } from './authority-config.types';
import { type AuthorityScope, authorityScopeKey } from './authority-scope.types';
import {
  AuthorityAmbiguityReasonValues,
  type AuthorityAmbiguityReason,
  type AuthorityHolderCandidate,
  selectAuthorityHolder,
} from './authority-selection.types';
import {
  AUTHORITY_QUESTION_DESCRIPTORS,
  AuthorityQuestionValues,
  type AuthorityQuestion,
} from './authority-question.types';

/**
 * One connection, reduced to what resolution depends on.
 *
 * Structural by necessity (the empty allow-set) and by design — the same reason
 * `AuthorityHolderCandidate` and `InvoicingConnectionCandidate` are.
 *
 * **The caller passes EVERY connection, whatever its status.** `analytics-trust`
 * had to opt into `includeAllStatuses` because an active-only filter silently
 * dropped exactly the connections its surface existed to warn about; the same
 * trap applies here, so status is reported rather than filtered upstream.
 */
export interface AuthorityClaimantInput {
  readonly connectionId: string;
  /**
   * `connection.status === 'active'`. An inactive connection's claim is REPORTED
   * but never eligible: `getCapabilityAdapter` is active-only, which is why the
   * leaf already carries a `holder-connection-unresolvable` unresolved reason.
   * It therefore cannot create — or break — an ambiguity.
   */
  readonly isActive: boolean;
  /** What the adapter manifest advertises (`AdapterMetadata.supportedCapabilities`). */
  readonly supportedCapabilities: readonly string[];
  /** What the operator enabled on the connection (`Connection.enabledCapabilities`). */
  readonly enabledCapabilities: readonly string[];
  /** Raw, untrusted `Connection.config` jsonb — coerced here by `parseAuthorityConfig`. */
  readonly config: unknown;
}

export interface AuthorityResolutionInput {
  readonly claimants: readonly AuthorityClaimantInput[];
}

/** How well resolved a row is. Derived — see {@link deriveAuthorityState}. */
export const AuthorityStateValues = ['resolved', 'default', 'ambiguous', 'unavailable'] as const;

export type AuthorityState = (typeof AuthorityStateValues)[number];

/**
 * By what authority the answer was reached.
 *
 * Distinct from `state`, which says *how well resolved*. `source` is what lets
 * the surface derive spec §3.3's `Always` (A6) and `Elsewhere` (A7) badges
 * without testing `question === 'refund-trigger'` — a question literal in the
 * frontend is a second copy of a rule that lives here.
 */
export const AuthoritySourceValues = [
  /** Nobody claimed it; today's shipped behaviour answers. */
  'default',
  /** An operator claim in `Connection.config` decided it. */
  'operator-config',
  /** A6 — never assignable, whatever any config says (ADR-056). */
  'fixed-by-design',
  /** A7 — answered by `sales-documents`, reached by a link. */
  'delegated',
] as const;

export type AuthoritySource = (typeof AuthoritySourceValues)[number];

/** One party holding one authority over one scope. */
export interface AuthorityAnswerHolder {
  readonly connectionId: string;
  readonly scope: AuthorityScope;
}

/**
 * What answers the question.
 *
 * `holders` carries one *or many* entries: a compound answer ("My shop ·
 * Allegro") is ROUTINE, never attention-worthy, and must be structurally
 * distinct from `cannot-tell`. One holder is not a special case of it.
 */
export type AuthorityAnswer =
  /** OpenLinker itself decides. A1's default; A6 always. */
  | { readonly kind: 'openlinker' }
  /** One or more connections hold it. Several is a compound, not an ambiguity. */
  | { readonly kind: 'holders'; readonly holders: readonly AuthorityAnswerHolder[] }
  /** Nothing decides yet and the operator handles it by hand. A5's default. */
  | { readonly kind: 'manual' }
  /**
   * Today's behaviour, unchanged — A3's default. Deliberately NOT a derived
   * party list: naming the shipping parties needs a rule Wave 2 cannot validate
   * (it cannot observe which orders are marketplace-fulfilled), and the obvious
   * derivation is provably wrong on the spec's own worked example. The surface
   * renders the party list from connection data it already holds.
   */
  | { readonly kind: 'default-today' }
  /** A2 on a single-origin topology: there is nothing to choose between. */
  | { readonly kind: 'nobody-to-route' }
  /** Two or more systems claim one scope. Inert and reported; holds nothing. */
  | {
      readonly kind: 'cannot-tell';
      readonly reason: AuthorityAmbiguityReason;
      readonly candidateConnectionIds: readonly string[];
    }
  /** A7 — configured under another surface entirely, never mirrored here. */
  | { readonly kind: 'configured-elsewhere'; readonly surface: 'sales-documents' };

/**
 * The default arm's why-codes — the identity of a line, never the line itself.
 *
 * Core emits no operator-facing English: it would bypass the `check-ui-vocabulary`
 * gate, could never enter the frontend's `t(key, fallback)` i18n seam, and would
 * make #2354's own "copy passes the vocabulary gate" acceptance criterion
 * unsatisfiable by construction. Copy is owned by #2354 / #2357.
 */
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

/**
 * Two arms, not one flat list.
 *
 * Spec §3.3: an ambiguous row's why-line is *replaced* by the §4.2 body copy
 * rather than qualified by it, so the surface must tell the two apart
 * mechanically. A flat union would make that a string-prefix convention, and
 * #2352 widens the ambiguity half under a different issue with a different
 * mirror script — two vocabularies with two owners in one list.
 *
 * The ambiguity arm reuses the already-shipped `AuthorityAmbiguityReason`, so
 * #2352 extends it without touching the default arm.
 */
export type AuthorityWhy =
  | { readonly kind: 'default'; readonly code: AuthorityDefaultWhyCode }
  | { readonly kind: 'ambiguous'; readonly reason: AuthorityAmbiguityReason };

/** One rendered row of the "Who decides what" table. */
export interface AuthorityAnswerView {
  readonly question: AuthorityQuestion;
  /** Derived from `(source, answer.kind)` — see {@link deriveAuthorityState}. */
  readonly state: AuthorityState;
  readonly answer: AuthorityAnswer;
  readonly why: AuthorityWhy;
  readonly source: AuthoritySource;
  /**
   * Connections claiming this authority that are not active, and so were not
   * eligible to hold it. Reported so the surface can say *"a disabled connection
   * claims this"*; never changes `answer` or `state`.
   */
  readonly inactiveClaimantConnectionIds: readonly string[];
}

/**
 * `state` is a function of `(source, answer.kind)` and nothing else.
 *
 * It is shipped rather than left to each consumer — the
 * `OrderInvoiceProjectionDto.blocksIssuanceElsewhere` precedent (#2100): a
 * surface that re-derives a predicate eventually derives it differently. Single
 * producer, and a spec pins the invariant across all seven rows.
 */
function deriveAuthorityState(source: AuthoritySource, answer: AuthorityAnswer): AuthorityState {
  if (answer.kind === 'cannot-tell') {
    return 'ambiguous';
  }
  switch (source) {
    case 'delegated':
      return 'unavailable';
    case 'fixed-by-design':
    case 'operator-config':
      return 'resolved';
    case 'default':
      return 'default';
  }
}

/** The default (unclaimed) answer + why for each resolvable authority. */
const DEFAULT_ANSWER: Readonly<
  Record<AuthorityKind, { answer: AuthorityAnswer; code: AuthorityDefaultWhyCode }>
> = Object.freeze({
  availability: Object.freeze({
    answer: { kind: 'openlinker' } as AuthorityAnswer,
    code: 'a1-computed-from-master-minus-buffer' as const,
  }),
  sourcing: Object.freeze({
    answer: { kind: 'nobody-to-route' } as AuthorityAnswer,
    code: 'a2-single-origin-nothing-to-choose' as const,
  }),
  'fulfillment-execution': Object.freeze({
    answer: { kind: 'default-today' } as AuthorityAnswer,
    code: 'a3-lands-where-it-does-today' as const,
  }),
  'order-lifecycle': Object.freeze({
    answer: { kind: 'openlinker' } as AuthorityAnswer,
    code: 'a4-derived-from-observed-facts' as const,
  }),
  'returns-disposition': Object.freeze({
    answer: { kind: 'manual' } as AuthorityAnswer,
    code: 'a5-nothing-decides-yet-handled-by-hand' as const,
  }),
  'refund-trigger': Object.freeze({
    // Unreachable: A6 short-circuits before any claim is read. Present so the
    // record stays total over `AuthorityKind`.
    answer: { kind: 'openlinker' } as AuthorityAnswer,
    code: 'a6-only-ol-holds-payment-credentials' as const,
  }),
});

/** The why-code for a row that resolved to one or more claimed holders. */
const CLAIMED_WHY: Readonly<Record<AuthorityKind, AuthorityDefaultWhyCode>> = Object.freeze({
  availability: 'a1-claimed-by-connection',
  sourcing: 'a2-claimed-by-connection',
  'fulfillment-execution': 'a3-claimed-by-connection',
  'order-lifecycle': 'a4-claimed-by-connection',
  'returns-disposition': 'a5-claimed-by-connection',
  // Unreachable — A6 is never claimed. Total by construction.
  'refund-trigger': 'a6-only-ol-holds-payment-credentials',
});

/**
 * Does this claimant declare the capability gating `kind`?
 *
 * Reads the **union** of both declaration lists, and the union is forced rather
 * than stylistic. A5 (`ReturnsAuthority`) is operator-enabled, so it lives in
 * `enabledCapabilities`. A1 (`AvailabilityAuthority`) is deliberately NOT in
 * `CoreCapabilityValues` until `W3a-14`, so the connection DTOs' `@IsIn` reject
 * it and it can never appear there — gating A1 on `enabledCapabilities` alone
 * would make this issue's own headline flag unresolvable by construction. An
 * adapter may still advertise it in `supportedCapabilities` (open-world, #576).
 *
 * Never `platformType`, which `AuthorityClaimantInput` does not carry.
 */
function declaresCapability(claimant: AuthorityClaimantInput, kind: AuthorityKind): boolean {
  const required = AUTHORITY_KIND_DESCRIPTORS[kind].capability;
  if (required === 'config-only') {
    return true;
  }
  return (
    claimant.supportedCapabilities.includes(required) ||
    claimant.enabledCapabilities.includes(required)
  );
}

/** Every scope this claimant claims for `kind`; an unnarrowed claim means `global`. */
function claimedScopes(claim: { scopes: readonly AuthorityScope[] }): readonly AuthorityScope[] {
  return claim.scopes.length > 0 ? claim.scopes : [{ kind: 'global' } as const];
}

/**
 * Resolve one authority across every scope it is claimed over, and fold.
 *
 * **Never a single `{ kind: 'global' }` request.** `selectAuthorityHolder` keeps
 * only claims covering the requested scope — exactly, or by an enclosing
 * `global` — and its enclosing tier is empty *by construction* when `global` is
 * what was requested. So a `channel`- or `location`-scoped claim would land in
 * neither tier and resolve to `none`, and the page built to show an operator
 * their configuration would report "nobody claims this" about a claim that
 * exists. Channel-scoped claims are the DESIGNED shape for A2/A5 (DESIGN §2.1)
 * and A1's `scopes` array is this issue's headline flag, so that is the common
 * case, not a corner.
 *
 * `selectAuthorityHolder` is composed here, never modified.
 */
/**
 * Reduce A2's selection to a rendered row.
 *
 * A COMPOUND holder set is a routine answer, never an ambiguity — see
 * `FulfillmentRouterSelection.holders`. Only a real misconfiguration reaches
 * `cannot-tell`.
 */
function resolveSourcingAuthority(selection: FulfillmentRouterSelection): {
  answer: AuthorityAnswer;
  source: AuthoritySource;
  why: AuthorityWhy;
} {
  if (AMBIGUITY_REASONS.includes(selection.reason)) {
    const reason = selection.reason as AuthorityAmbiguityReason;
    return {
      answer: {
        kind: 'cannot-tell',
        reason,
        candidateConnectionIds: selection.candidateConnectionIds,
      },
      source: 'operator-config',
      why: { kind: 'ambiguous', reason },
    };
  }

  if (selection.holders.length === 0) {
    const fallback = DEFAULT_ANSWER.sourcing;
    return {
      answer: fallback.answer,
      source: 'default',
      why: { kind: 'default', code: fallback.code },
    };
  }

  return {
    answer: { kind: 'holders', holders: selection.holders },
    source: 'operator-config',
    why: { kind: 'default', code: CLAIMED_WHY.sourcing },
  };
}

/**
 * The fold, shared by the A2 READ MODEL and the A2 WRITE GATE.
 *
 * Extracted in #2395 so that `resolveAuthorities`' A2 row and
 * `selectPrimaryFulfillmentRouter` cannot answer "who routes this order?"
 * differently. Two answers to one question is what ADR-053 exists to prevent,
 * and here it would be worse than a stale page: the surface would name one
 * router while the commit path chose another.
 *
 * Behaviour is byte-identical to the pre-#2395 body of `resolveOneAuthority`;
 * only the reduction to an `AuthorityAnswer` moved out.
 */
type HolderResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'holders'; readonly holders: readonly AuthorityAnswerHolder[] }
  | {
      readonly kind: 'ambiguous';
      readonly reason: AuthorityAmbiguityReason;
      readonly candidateIds: readonly string[];
    };

function resolveHolders(
  kind: AuthorityKind,
  claimants: readonly AuthorityClaimantInput[]
): HolderResolution {
  const candidates: AuthorityHolderCandidate[] = [];
  // Deduped on `(connection, scope)`. `parseAuthorityConfig` reads `scopes` off
  // untrusted jsonb and filters by shape, never by uniqueness, so one connection
  // may legitimately arrive carrying the SAME scope twice. Pushed twice it
  // becomes two candidates with one `connectionId`, `selectAuthorityHolder`
  // reports `multiple-claimants-same-scope` against `['c1','c1']`, and the row
  // tells an operator that two systems are fighting while naming one. Worse, the
  // #2353 apply guard is over the RESULT, so EVERY preset is then refused —
  // including `leave-as-they-are` and `openlinker-decides`, neither of which can
  // remove a duplicate array element — leaving the install locked out of the
  // page's only write path with hand-edited jsonb as the sole remedy.
  // A duplicated scope entry from one connection is ONE claim, not two claimants.
  const seenCandidates = new Set<string>();
  for (const claimant of claimants) {
    if (!claimant.isActive || !declaresCapability(claimant, kind)) {
      continue;
    }
    const claim = parseAuthorityConfig(claimant.config, kind);
    if (!claim.enabled) {
      continue;
    }
    for (const scope of claimedScopes(claim)) {
      const key = `${claimant.connectionId}@${authorityScopeKey(scope)}`;
      if (seenCandidates.has(key)) {
        continue;
      }
      seenCandidates.add(key);
      candidates.push({ connectionId: claimant.connectionId, scope, isPrimary: claim.isPrimary });
    }
  }

  if (candidates.length === 0) {
    return { kind: 'none' };
  }

  // One resolution per distinct claimed scope. A `global` claim is itself one of
  // those scopes, so it is resolved like any other and needs no special pass.
  const scopesByKey = new Map<string, AuthorityScope>();
  for (const candidate of candidates) {
    scopesByKey.set(authorityScopeKey(candidate.scope), candidate.scope);
  }

  const holders: AuthorityAnswerHolder[] = [];
  const seenHolders = new Set<string>();
  for (const scope of scopesByKey.values()) {
    const selection = selectAuthorityHolder(candidates, scope);
    if (selection.kind === 'ambiguous') {
      // Any ambiguous scope makes the whole row inert — the row cannot honestly
      // claim a holder while one of its scopes has none.
      return {
        kind: 'ambiguous',
        reason: selection.reason,
        candidateIds: selection.candidateIds,
      };
    }
    if (selection.kind === 'selected') {
      const key = `${selection.connectionId}@${authorityScopeKey(selection.scope)}`;
      if (!seenHolders.has(key)) {
        seenHolders.add(key);
        holders.push({ connectionId: selection.connectionId, scope: selection.scope });
      }
    }
  }

  if (holders.length === 0) {
    return { kind: 'none' };
  }

  return { kind: 'holders', holders };
}

function resolveOneAuthority(
  kind: AuthorityKind,
  claimants: readonly AuthorityClaimantInput[]
): { answer: AuthorityAnswer; source: AuthoritySource; why: AuthorityWhy } {
  if (kind === 'sourcing') {
    // A2 is answered THROUGH the same function the routing commit path calls
    // (#2395): the row an operator reads and the gate that commits work must not
    // be able to disagree about who routes.
    return resolveSourcingAuthority(selectPrimaryFulfillmentRouter(claimants));
  }

  const resolved = resolveHolders(kind, claimants);

  if (resolved.kind === 'ambiguous') {
    return {
      answer: {
        kind: 'cannot-tell',
        reason: resolved.reason,
        candidateConnectionIds: resolved.candidateIds,
      },
      source: 'operator-config',
      why: { kind: 'ambiguous', reason: resolved.reason },
    };
  }

  if (resolved.kind === 'none') {
    const fallback = DEFAULT_ANSWER[kind];
    return {
      answer: fallback.answer,
      source: 'default',
      why: { kind: 'default', code: fallback.code },
    };
  }

  return {
    answer: { kind: 'holders', holders: resolved.holders },
    source: 'operator-config',
    why: { kind: 'default', code: CLAIMED_WHY[kind] },
  };
}

/**
 * Why A2 resolved the way it did — non-null on EVERY arm.
 *
 * The three ambiguity members are SPREAD from `AuthorityAmbiguityReason` rather
 * than restated, so #2352 widening that union widens this one automatically
 * instead of leaving a value this function can produce and no consumer can name.
 *
 * `multiple-scoped-holders` is this function's own, and has no counterpart in
 * `AuthorityAmbiguityReason` because it is not a misconfiguration — see
 * {@link selectPrimaryFulfillmentRouter}.
 */
export const FulfillmentRouterSelectionReasonValues = [
  /** Nobody claims A2. Today's path runs untouched — ADR-054's pass-through. */
  'no-claimant',
  /** Exactly one router. The only arm that may commit. */
  'claimed-by-connection',
  /** Several routers legitimately hold A2 over different scopes. */
  'multiple-scoped-holders',
  ...AuthorityAmbiguityReasonValues,
] as const;

export type FulfillmentRouterSelectionReason =
  (typeof FulfillmentRouterSelectionReasonValues)[number];

/**
 * Who routes this order, and why that is the answer.
 *
 * `{ holder, reason }` on every arm is the Wave-2 §7.1 obligation: the "Who
 * decides what" surface renders A2 from this, and a null reason degrades that
 * row to *"OpenLinker can't tell"* on every install that HAS configured a
 * router. So `reason` is non-null even when `holder` is.
 */
export interface FulfillmentRouterSelection {
  /**
   * The single router to commit through, or `null`.
   *
   * `null` on `no-claimant`, on every ambiguity, AND on
   * `multiple-scoped-holders` — the routing commit path may act only on exactly
   * one.
   */
  readonly holder: string | null;
  readonly reason: FulfillmentRouterSelectionReason;
  /** Everyone in contention. Empty only on `no-claimant`. */
  readonly candidateConnectionIds: readonly string[];
  /**
   * Every holder with its scope, for the A2 read model's COMPOUND answer.
   *
   * The read model and the write gate diverge here deliberately, and this is the
   * one place they may. Two routers scoped to different channels is a routine
   * compound answer for a page to render ("My shop · Allegro") and is NOT
   * attention-worthy. It is nonetheless unusable by the commit path, which needs
   * one router for one order and cannot narrow by channel in Wave 3a. So the
   * page shows both and routing refuses — reported, never resolved arbitrarily,
   * because a wrong pick here is a double shipment.
   */
  readonly holders: readonly AuthorityAnswerHolder[];
}

const AMBIGUITY_REASONS: readonly string[] = AuthorityAmbiguityReasonValues;

/** Is this reason a misconfiguration, as opposed to a legitimate compound? */
export const isFulfillmentRouterAmbiguity = (
  reason: FulfillmentRouterSelectionReason
): boolean => AMBIGUITY_REASONS.includes(reason) || reason === 'multiple-scoped-holders';

/**
 * Which connection's router decides where an order is sourced from (#2395).
 *
 * ## Why this lives in `fulfillment-authority` and not in `fulfillment`
 *
 * Because `resolveAuthorities` must consume it, and it cannot reach out to get
 * it: this leaf carries an **empty** `authorizedTypeOnlySpecifiers` allow-set in
 * `barrel-purity.spec.ts` — stricter than every other context, not even a
 * type-only import permitted — so a `fulfillment -> fulfillment-authority`
 * placement would make the A2 row unable to see its own answer, and the surface
 * would fall back to a default while a router was configured.
 *
 * Note what is NOT the reason, because it is the plausible one and it is wrong:
 * the `fulfillment` leaf's own value-import ban is irrelevant here, since the
 * only caller of this function outside core is a worker HANDLER, which is not
 * under `libs/core/src/fulfillment/**` and which that rule therefore never
 * reaches.
 *
 * ADR-053 asks that ENFORCEMENT resolution live with the context that owns the
 * write, and it still does: the write gate is the `routing_decisions` live
 * partial-unique index and the guard around it, both in `fulfillment`. This
 * function only names a candidate. Naming is not enforcing — nothing here can
 * commit anything.
 *
 * ## The rule
 *
 * Folds over the scopes actually claimed, exactly as `resolveOneAuthority` does
 * — never a single `{ kind: 'global' }` request, which would resolve a
 * channel-scoped claim to `none` and report "nobody claims this" about a claim
 * that exists (the regression D10 shape; channel-scoped claims are the DESIGNED
 * shape for A2).
 *
 * Then it reduces: exactly one distinct holder may route. Anything else yields
 * `holder: null`, which commits nothing and is reported. Silence-and-pick-one is
 * forbidden here for the reason it is forbidden in #2047 — an unrouted order is
 * recoverable by hand, two shipments of one order are not.
 *
 * Pure, total, never throws.
 */
export function selectPrimaryFulfillmentRouter(
  claimants: readonly AuthorityClaimantInput[]
): FulfillmentRouterSelection {
  const resolved = resolveHolders('sourcing', claimants);

  if (resolved.kind === 'none') {
    return {
      holder: null,
      reason: 'no-claimant',
      candidateConnectionIds: [],
      holders: [],
    };
  }

  if (resolved.kind === 'ambiguous') {
    return {
      holder: null,
      reason: resolved.reason,
      candidateConnectionIds: resolved.candidateIds,
      holders: [],
    };
  }

  const distinct = [...new Set(resolved.holders.map((holder) => holder.connectionId))];

  return {
    holder: distinct.length === 1 ? distinct[0] : null,
    reason: distinct.length === 1 ? 'claimed-by-connection' : 'multiple-scoped-holders',
    candidateConnectionIds: distinct,
    holders: resolved.holders,
  };
}


/** Claimants that claim `kind` but are not active — reported, never eligible. */
function inactiveClaimants(
  kind: AuthorityKind,
  claimants: readonly AuthorityClaimantInput[]
): string[] {
  return claimants
    .filter(
      (claimant) =>
        !claimant.isActive &&
        declaresCapability(claimant, kind) &&
        parseAuthorityConfig(claimant.config, kind).enabled
    )
    .map((claimant) => claimant.connectionId);
}

/**
 * Answer all seven questions of spec §3.3.
 *
 * Pure, total and never throwing: returns exactly seven rows in
 * `AuthorityQuestionValues` order, each carrying a concrete answer AND a why,
 * on any input including an empty one. A malformed `config` yields that row's
 * default rather than an exception, because every eventual caller sits on a path
 * where throwing would turn a reportable misconfiguration into a failed request.
 *
 * Its output may render and may inform, and may never gate a write.
 */
export function resolveAuthorities(
  input: AuthorityResolutionInput
): readonly AuthorityAnswerView[] {
  const claimants = input.claimants;

  return AuthorityQuestionValues.map((question): AuthorityAnswerView => {
    const { kind } = AUTHORITY_QUESTION_DESCRIPTORS[question];

    // A7 — owned by `sales-documents`. Answered by a link, never mirrored, and
    // resolved before any claim is read so no config can appear to move it.
    if (kind === null) {
      const answer: AuthorityAnswer = {
        kind: 'configured-elsewhere',
        surface: 'sales-documents',
      };
      return {
        question,
        state: deriveAuthorityState('delegated', answer),
        answer,
        why: { kind: 'default', code: 'a7-configured-under-sales-documents' },
        source: 'delegated',
        inactiveClaimantConnectionIds: [],
      };
    }

    // A6 — refund authority never leaves OpenLinker (ADR-056). Short-circuited
    // BEFORE any claimant is consulted, so no config value can be honoured as a
    // grant and two claimants cannot manufacture an ambiguity. `refundTrigger`
    // remains readable so a claim is observable; it is never delegation.
    if (kind === 'refund-trigger') {
      const answer: AuthorityAnswer = { kind: 'openlinker' };
      return {
        question,
        state: deriveAuthorityState('fixed-by-design', answer),
        answer,
        why: { kind: 'default', code: 'a6-only-ol-holds-payment-credentials' },
        source: 'fixed-by-design',
        inactiveClaimantConnectionIds: [],
      };
    }

    const { answer, source, why } = resolveOneAuthority(kind, claimants);
    return {
      question,
      state: deriveAuthorityState(source, answer),
      answer,
      why,
      source,
      inactiveClaimantConnectionIds: inactiveClaimants(kind, claimants),
    };
  });
}
