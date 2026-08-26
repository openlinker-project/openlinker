/**
 * Authority Attention Reasons (#2352, Wave-2 product spec §4.2 / §4.3)
 *
 * The operator-facing vocabulary of *inert states* — the things OpenLinker is
 * NOT doing, each with the surface it renders on and whether it is counted. It
 * is the vocabulary behind `Needs attention (N)` and behind every cross-surface
 * row badge, and it is the #2100 reason-vocabulary shape reused wholesale.
 *
 * ## Why this is a THIRD union rather than a widening of an existing one
 *
 * Three questions live in this leaf and they are not the same question:
 *
 *  - `AuthorityAmbiguityReason` — *why could `selectAuthorityHolder` not pick one?*
 *  - `FulfillmentAuthorityBlockReason` — *why did authority resolution fail?*
 *  - **this** — *what is the operator looking at, on which surface, and is it counted?*
 *
 * Four of the eight members below (`line-unfulfillable`, `reservation-shortfall`,
 * `restock-blocked`, `return-unmatched`) are not authority-resolution failures at
 * all: a reservation shortfall is a stock fact, not an ambiguity, and no widening
 * of either existing union could express it without lying about what it means.
 *
 * The other three ARE — and are therefore **projections, never parallel
 * spellings**. `fulfillment-authority-outcome.types.ts` warns in terms that a
 * second shape "would give operators two vocabularies for one situation", so
 * `attentionReasonForAuthorityBlock` derives them FROM a `FulfillmentAuthorityBlock`
 * and `attentionReasonForAuthorityQuestion` is a thin composition over it. The
 * persisted path (an owning context's resolver, ADR-053) and the derived path
 * (the read model, #2351) therefore cannot disagree.
 *
 * ## Derived vs persisted — and the half of A1-U that is neither
 *
 * `DESCRIPTORS[…].origin` says where each state comes from:
 *
 *  - `authority-resolution` — a pure function of `Connection.config`, recomputed by
 *    `resolveAuthorities` on every read. **Never persisted**: a stored copy would be
 *    a second answer to a question a pure function already answers, with a staleness
 *    window and no natural write trigger (and `ConnectionRepository.update` is a
 *    read-modify-write full-row `save()`, so it would race the operator's own edit).
 *  - `attribution` — likewise derived, from one nullable column: a return is orphaned
 *    exactly when `internalOrderId IS NULL` (`ReturnRecord.isOrphan()`, #2332).
 *  - `persisted` — a fact about one work object that no pure function can recompute.
 *    Stored in the `omsAttention` jsonb (see {@link AuthorityAttentionEntry}).
 *
 * **A1-U is covered here only in its AMBIGUITY half.** Spec §4.2 words it as *"two
 * connections claim the same stock, **or the claiming system errored**"*. The second
 * half is a RUNTIME fact — `getCapabilityAdapter` is active-only, which is why this
 * leaf already carries `holder-connection-unresolvable` — and is not expressible in
 * `Connection.config`, so `resolveAuthorities` cannot derive it. It belongs to
 * `inventory`'s own enforcement resolution (ADR-053) and is deliberately out of scope
 * here; a consumer must not read `availability-unknown` as "A1-U is fully handled".
 *
 * ## AF-X is deliberately absent
 *
 * Spec §4.2 lists NINE rows; this union has eight. `AF-X` (*"an automation couldn't
 * finish"*) is produced per automation FIRING, carries the underlying operation's own
 * verbatim reason, and clears on retry or on an explicit *"I handled this myself"* —
 * a lifecycle no entry here models. It is owned by the automation body (spec §5.3 /
 * §5.6). The totality spec therefore asserts an explicit eight, never a spec row count.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 * @see docs/plans/implementation-plan-inert-state-reason-vocabulary.md
 */

import type { AuthorityKind } from './authority-kind.types';
import { AUTHORITY_QUESTION_DESCRIPTORS, type AuthorityQuestion } from './authority-question.types';
import type { FulfillmentAuthorityBlock } from './fulfillment-authority-outcome.types';

/**
 * The eight inert states of spec §4.2, in the order that section tables them.
 *
 * One member per line, no computed keys and no spread: the repo's mirror scripts
 * read these arrays TEXTUALLY, and #2357's `check-attention-reason-mirror.mjs`
 * will read this one.
 */
export const AuthorityAttentionReasonValues = [
  /** A1-U — two systems claim the same stock, so nothing is published. Ambiguity half only. */
  'availability-unknown',
  /** A2-A — two enabled routers on one source, so neither routes. */
  'sourcing-ambiguous',
  /** A3-X — every candidate rejected or timed out; the work is unassigned. */
  'fulfillment-unaccepted',
  /** UF-L — a line cannot be shipped from anywhere. A refund/return decision, not a fix. */
  'line-unfulfillable',
  /** RS-S — the stock master dropped below what this order was promised. */
  'reservation-shortfall',
  /** A5-A — two enabled returns authorities, so nothing is restocked or scrapped. */
  'returns-disposition-ambiguous',
  /** RB-L — a restock was refused by the system that owns the stock. */
  'restock-blocked',
  /** OR-P — a return OL could not attribute to any order. */
  'return-unmatched',
] as const;

export type AuthorityAttentionReason = (typeof AuthorityAttentionReasonValues)[number];

/**
 * The short row label, as a CODE.
 *
 * Spec §4.2's closed four-value badge vocabulary (`Stopped` / `At risk` / `Blocked`
 * / `Not matched`), spelled as codes because core emits no operator-facing English
 * — it would bypass `check-ui-vocabulary`, could never enter the frontend's
 * `t(key, fallback)` seam, and would make #2354's own copy-gate criterion
 * unsatisfiable. Copy is owned by #2357.
 */
export const AuthorityAttentionBadgeValues = [
  'stopped',
  'at-risk',
  'blocked',
  'not-matched',
] as const;

export type AuthorityAttentionBadge = (typeof AuthorityAttentionBadgeValues)[number];

/**
 * Where a state renders.
 *
 * Deliberately a LIST and deliberately not named for where the fact originates:
 * A1-U originates on a connection's configuration and renders on the affected
 * PRODUCT rows ("publishing for these products is paused"), so one field cannot
 * be both. `origin` below answers the other question.
 */
export const AuthorityAttentionSurfaceValues = [
  'order',
  'product',
  'return',
  'connection',
] as const;

export type AuthorityAttentionSurface = (typeof AuthorityAttentionSurfaceValues)[number];

/** How a state is obtained — see the module docblock. */
export const AuthorityAttentionOriginValues = [
  /** Recomputed by `resolveAuthorities` from `Connection.config`. Never persisted. */
  'authority-resolution',
  /** Derived from the return's own attribution column (`internalOrderId IS NULL`). */
  'attribution',
  /** A work-object fact, stored in the `omsAttention` jsonb by its producer. */
  'persisted',
] as const;

export type AuthorityAttentionOrigin = (typeof AuthorityAttentionOriginValues)[number];

/**
 * Which subsystem answers a persisted state's question.
 *
 * **This is the field that makes the persisted half safe.** The eventual writers are
 * three unrelated subsystems, and an order can genuinely carry two states at once (one
 * line unroutable, another short). A level-triggered *scalar* column would make each
 * producer's "nothing is wrong" a complete statement about the whole row — honest about
 * its own question and a lie about the others' — so the Needs-attention count would
 * depend on which subsystem ran last. The producer is therefore part of the write
 * signature: clearing means *clear my entry*, never *clear the row*.
 *
 * `'derived'` is not a member: a derived state is never written.
 */
export const AuthorityAttentionProducerValues = [
  /** The reservation ledger (RS-S). */
  'reservations',
  /** Sourcing / routing (UF-L). */
  'routing',
  /** The fulfillment execution handshake (A3-X). */
  'acceptance',
  /** Returns restock disposition (RB-L). */
  'returns-restock',
] as const;

export type AuthorityAttentionProducer = (typeof AuthorityAttentionProducerValues)[number];

export interface AuthorityAttentionReasonDescriptor {
  /** The spec §4.2 row label, so a reader can cross-reference the product spec. */
  readonly specRow: string;
  readonly badge: AuthorityAttentionBadge;
  /** Every surface this state renders on. Never one — see {@link AuthorityAttentionSurfaceValues}. */
  readonly surfaces: readonly AuthorityAttentionSurface[];
  readonly origin: AuthorityAttentionOrigin;
  /**
   * The producer that writes this state, or `null` for a derived one.
   * Present iff `origin === 'persisted'` — asserted in the spec.
   */
  readonly producer: AuthorityAttentionProducer | null;
  /**
   * The `AuthorityKind` whose ambiguity this state IS, or `null`.
   *
   * Present exactly for the three members that are a projection of a
   * `FulfillmentAuthorityBlock` (R-B3): it is what keeps the persisted and the
   * derived path from drifting, and what `attentionReasonForAuthorityBlock`
   * inverts. Never a free-text cross-reference.
   */
  readonly equivalentAuthorityKind: AuthorityKind | null;
  /**
   * Whether this state contributes to the `Needs attention (N)` count.
   *
   * Today every member is `true`, so {@link AuthorityAttentionCountedReasonValues}
   * is the full list and the flag discriminates nothing — say so rather than let a
   * reader assume the split is load-bearing HERE. It is not: §4.3's routine half
   * (a default answer, "nothing to route", a compound answer, an observation) lives
   * on the who-decides ROW as an `AuthorityState` / `AuthoritySource` / `AuthorityAnswer`
   * from #2351, and is structurally incapable of entering this union — which is why
   * the A2-`none` regression (#2356) cannot be counted. The flag exists so that
   * opting a future member OUT is a deliberate edit here rather than a `filter`
   * predicate invented at a call site.
   */
  readonly counted: boolean;
}

/** One entry per `AuthorityAttentionReason`, in the same order. */
export const AUTHORITY_ATTENTION_REASON_DESCRIPTORS: Readonly<
  Record<AuthorityAttentionReason, AuthorityAttentionReasonDescriptor>
> = Object.freeze({
  'availability-unknown': Object.freeze({
    specRow: 'A1-U',
    badge: 'stopped',
    // Originates on connections; renders on the PRODUCTS whose publishing is paused,
    // and on the claiming connections so each can be named and linked.
    surfaces: Object.freeze(['product', 'connection'] as const),
    origin: 'authority-resolution',
    producer: null,
    equivalentAuthorityKind: 'availability',
    counted: true,
  }),
  'sourcing-ambiguous': Object.freeze({
    specRow: 'A2-A',
    badge: 'stopped',
    surfaces: Object.freeze(['order', 'connection'] as const),
    origin: 'authority-resolution',
    producer: null,
    equivalentAuthorityKind: 'sourcing',
    counted: true,
  }),
  'fulfillment-unaccepted': Object.freeze({
    specRow: 'A3-X',
    badge: 'stopped',
    surfaces: Object.freeze(['order'] as const),
    origin: 'persisted',
    producer: 'acceptance',
    equivalentAuthorityKind: 'fulfillment-execution',
    counted: true,
  }),
  'line-unfulfillable': Object.freeze({
    specRow: 'UF-L',
    badge: 'at-risk',
    surfaces: Object.freeze(['order'] as const),
    origin: 'persisted',
    producer: 'routing',
    equivalentAuthorityKind: null,
    counted: true,
  }),
  'reservation-shortfall': Object.freeze({
    specRow: 'RS-S',
    badge: 'at-risk',
    surfaces: Object.freeze(['order', 'product'] as const),
    origin: 'persisted',
    producer: 'reservations',
    equivalentAuthorityKind: null,
    counted: true,
  }),
  'returns-disposition-ambiguous': Object.freeze({
    specRow: 'A5-A',
    badge: 'stopped',
    surfaces: Object.freeze(['return', 'connection'] as const),
    origin: 'authority-resolution',
    producer: null,
    equivalentAuthorityKind: 'returns-disposition',
    counted: true,
  }),
  'restock-blocked': Object.freeze({
    specRow: 'RB-L',
    badge: 'blocked',
    surfaces: Object.freeze(['return'] as const),
    origin: 'persisted',
    producer: 'returns-restock',
    equivalentAuthorityKind: null,
    counted: true,
  }),
  'return-unmatched': Object.freeze({
    specRow: 'OR-P',
    badge: 'not-matched',
    surfaces: Object.freeze(['return'] as const),
    origin: 'attribution',
    producer: null,
    equivalentAuthorityKind: null,
    counted: true,
  }),
});

/**
 * The aggregate-worthy subset — what the `Needs attention (N)` count and the
 * `?attention=` filter may include.
 *
 * Derived from the descriptor table rather than hand-listed, exactly as
 * `SalesDocumentAttentionReasonValues` is, so a member added later is
 * attention-worthy by default and opting one out is a deliberate edit.
 *
 * A consumer builds a SQL literal list from this array, so emptiness would be a
 * syntax error — pinned in the spec rather than guarded at runtime, keeping this
 * module free of top-level side effects.
 */
export const AuthorityAttentionCountedReasonValues: readonly AuthorityAttentionReason[] =
  AuthorityAttentionReasonValues.filter(
    (reason) => AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason].counted
  );

/**
 * One persisted inert state, as stored in the `omsAttention` jsonb array.
 *
 * `producer` is the level-trigger key: a writer replaces or removes ONLY its own
 * entry, so three subsystems coexist on one row without erasing each other.
 */
export interface AuthorityAttentionEntry {
  readonly producer: AuthorityAttentionProducer;
  readonly reason: AuthorityAttentionReason;
  /**
   * PII-free elaboration (ids and counts only) rendered verbatim to an operator.
   * Never parsed, never a second reason channel.
   */
  readonly detail?: string;
  /**
   * The sub-object this entry is really about, when the row is not it — an
   * order line for UF-L, a return line for RB-L. The badge stays per row; this
   * is what lets the body copy name the line.
   */
  readonly subjectRef?: string;
  /**
   * When THIS producer's entry first appeared, ISO-8601.
   *
   * Preserved across a change of reason within one episode (#2248's `blockedAt`
   * rule, applied per entry): an operator watching "how long has this been stuck"
   * must not see the clock reset because the reason was refined. Carried inside
   * the entry rather than as header columns, so a second producer does not need a
   * second pair of columns and a second migration.
   */
  readonly since: string;
}

/** What a producer reports about ITS OWN question, for one row. */
export type AuthorityAttentionOutcome =
  /** This producer has nothing to report. The writer REMOVES this producer's entry. */
  | { readonly kind: 'none' }
  /** Carries the state to persist under this producer. */
  | {
      readonly kind: 'blocked';
      readonly reason: AuthorityAttentionReason;
      readonly detail?: string;
      readonly subjectRef?: string;
    }
  /**
   * The producer could not reach a conclusion. The writer LEAVES the stored entry
   * alone. Never collapsed into `none`: clearing on a transient error erases a true
   * reason and replaces it with silence, which is worse than a stale one (#2100).
   */
  | { readonly kind: 'indeterminate' };

/** Narrow an untrusted string (a persisted value, a query param) to the union. */
export function isAuthorityAttentionReason(value: unknown): value is AuthorityAttentionReason {
  return (
    typeof value === 'string' &&
    (AuthorityAttentionReasonValues as readonly string[]).includes(value)
  );
}

/** Narrow an untrusted string to an {@link AuthorityAttentionProducer}. */
export function isAuthorityAttentionProducer(value: unknown): value is AuthorityAttentionProducer {
  return (
    typeof value === 'string' &&
    (AuthorityAttentionProducerValues as readonly string[]).includes(value)
  );
}

/**
 * Coerce one untrusted stored element into an {@link AuthorityAttentionEntry}.
 *
 * Returns `null` for anything this build does not recognise — a reason written by a
 * newer release and then rolled back, a truncated entry, a non-object. The row then
 * renders neutrally and is NOT counted, which is spec §4.4 S2-5 restated as code
 * rather than inherited by accident.
 */
export function readAuthorityAttentionEntry(value: unknown): AuthorityAttentionEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isAuthorityAttentionProducer(candidate.producer) ||
    !isAuthorityAttentionReason(candidate.reason) ||
    typeof candidate.since !== 'string'
  ) {
    return null;
  }
  return {
    producer: candidate.producer,
    reason: candidate.reason,
    ...(typeof candidate.detail === 'string' ? { detail: candidate.detail } : {}),
    ...(typeof candidate.subjectRef === 'string' ? { subjectRef: candidate.subjectRef } : {}),
    since: candidate.since,
  };
}

/**
 * Coerce a whole untrusted `omsAttention` column into entries, dropping the
 * unreadable ones. A non-array (including `null`) yields `[]`.
 */
export function readAuthorityAttentionEntries(
  value: unknown
): readonly AuthorityAttentionEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: AuthorityAttentionEntry[] = [];
  for (const element of value) {
    const entry = readAuthorityAttentionEntry(element);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * The attention state a `FulfillmentAuthorityBlock` IS, or `null`.
 *
 * The primitive of R-B3: the three ambiguity members are a PROJECTION of the block
 * vocabulary the leaf already ships, never a parallel spelling of it, so an owning
 * context's persisted block and this read model cannot describe one situation two
 * ways. Only an unresolved (ambiguous) block projects — a block that resolved and
 * was refused for some other reason is not one of spec §4.2's states.
 */
export function attentionReasonForAuthorityBlock(
  block: FulfillmentAuthorityBlock
): AuthorityAttentionReason | null {
  if (block.reason !== 'unresolved-authority') {
    return null;
  }
  return attentionReasonForAuthorityKind(block.kind);
}

/** The attention state an `AuthorityKind`'s ambiguity projects to, or `null`. */
export function attentionReasonForAuthorityKind(
  kind: AuthorityKind
): AuthorityAttentionReason | null {
  for (const reason of AuthorityAttentionReasonValues) {
    if (AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason].equivalentAuthorityKind === kind) {
      return reason;
    }
  }
  return null;
}

/**
 * The attention state an AMBIGUOUS who-decides row renders.
 *
 * Spec §3.3: an ambiguous row's why-line is *replaced* by the §4.2 body copy for the
 * matching state rather than qualified by it. This is that mapping, owned here so the
 * settings page and the browser do not each restate a question→state rule — and it is
 * a thin composition over {@link attentionReasonForAuthorityKind}, per R-B3.
 *
 * A4 (`order-lifecycle`), A6 (`refund-trigger`) and A7 (`sales-documents`) return
 * `null`: A6 cannot be assigned and A7 is answered elsewhere, so neither ever takes
 * the ambiguous value, and A4 has no §4.2 state of its own.
 */
export function attentionReasonForAuthorityQuestion(
  question: AuthorityQuestion
): AuthorityAttentionReason | null {
  const { kind } = AUTHORITY_QUESTION_DESCRIPTORS[question];
  return kind === null ? null : attentionReasonForAuthorityKind(kind);
}
