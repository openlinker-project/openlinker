/**
 * Attention-Reason Copy
 *
 * Every operator-facing string for spec §4.2's inert states, in one module —
 * the placement `returns-list.copy.ts` / `return-detail.copy.ts` established,
 * and the one `scripts/check-ui-vocabulary.mjs` scans most precisely (every
 * string literal in a `*.copy.ts`, versus JSX text plus a scoped attribute
 * allowlist in a `.tsx`).
 *
 * ## One source, because two surfaces describe one state
 *
 * §4 requires an inert state to appear in `Needs attention` AND on the row the
 * operator is already looking at, with the SAME title. Every title is produced
 * through {@link attentionTitle}, which is what makes that structural rather
 * than a review promise. A renderer that assembles a title itself has
 * reintroduced the defect.
 *
 * Render order comes from `AuthorityAttentionReasonValues`, never
 * `Object.keys` of the map below — they agree today and would silently stop
 * agreeing the first time someone reorders the map.
 *
 * ## `action` is copy; the spec's "Fix" column is not
 *
 * Spec §4.2's Fix column ("Name both connections; link to each") instructs
 * whoever builds the renderer — it is not a sentence to show an operator. The
 * `action` field below carries real operator copy; WHAT a row links to remains
 * a component concern for #2356.
 *
 * ## RB-L and OR-P are owned by the returns spec
 *
 * Spec §4.2: their copy is owned by the returns spec §5.4 / §5.5 and the
 * mirror check "covers both feature folders". It is a CHECK, not an import —
 * `features/returns` is one of #2356's badge surfaces and will import this
 * module, so a static barrel-to-barrel edge would close a loop (#337/#359).
 * `scripts/check-attention-reason-mirror.mjs` MIRROR 6 asserts the OR-P title
 * equals `RETURN_ORPHAN_BANNER_COPY.title`; RB-L is declared here provisionally
 * with a pending pair naming #2364.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 4.2 / § 4.3
 */

import {
  AuthorityAttentionReasonValues,
  type AuthorityAttentionBadge,
  type AuthorityAttentionReason,
} from './attention-reason';

/**
 * The placeholders a title template may carry. `{n}` is a count, so a number
 * is accepted directly — forcing `String(n)` at every call site is how one of
 * them forgets.
 */
export interface AttentionTitleParams {
  readonly channel?: string;
  readonly ref?: string;
  readonly n?: string | number;
  readonly sku?: string;
}

export interface AttentionReasonCopy {
  /** May carry `{channel}` / `{ref}` / `{n}` / `{sku}`. Never rendered raw — go through {@link attentionTitle}. */
  readonly title: string;
  /**
   * A complete, placeholder-free sentence used when a placeholder the template
   * needs has no value.
   *
   * It exists as its own field rather than as per-token defaults because those
   * produce ungrammatical sentences ("Some line(s) on order this order"), and a
   * title is what an operator scans a list by.
   *
   * A placeholder-free title REPEATS ITSELF here, deliberately: the field stays
   * required so every entry answers the question, rather than optional-with-a-
   * default that a reader has to go and look up. `attentionTitle` never reaches
   * the fallback for such an entry (it has no placeholder to be missing), so the
   * repetition costs nothing at runtime.
   */
  readonly titleFallback: string;
  readonly body: string;
  /** What the operator can do. Operator copy — never the spec's implementer-facing Fix note. */
  readonly action: string;
}

/**
 * One entry per reason, in `AuthorityAttentionReasonValues` order.
 *
 * `satisfies`, not `:`, so the literal keeps its literal key types AND a
 * missing reason is a compile error.
 */
export const ATTENTION_REASON_COPY = {
  'availability-unknown': {
    title: "We don't know how much stock to publish",
    titleFallback: "We don't know how much stock to publish",
    body: "Two of your systems both say they're in charge of your stock, so OpenLinker won't guess. Publishing for these products is paused.",
    action: 'Open the connections named below and leave one of them in charge of stock.',
  },
  'sourcing-ambiguous': {
    title: 'Nothing is deciding where {channel} orders ship from',
    titleFallback: 'Nothing is deciding where these orders ship from',
    body: 'Two systems are set up to decide, so OpenLinker is doing neither. Orders are going out the way they did before.',
    action: 'Open the connections named below and leave one of them deciding.',
  },
  'fulfillment-unaccepted': {
    title: 'No one took the job for order {ref}',
    titleFallback: 'No one took the job for this order',
    body: "Every place that could have shipped it said no. It's waiting for you.",
    action: 'Open the order to see what each place said, then ship it yourself.',
  },
  'line-unfulfillable': {
    title: "{n} line(s) on order {ref} can't be shipped from anywhere",
    titleFallback: "Some lines on this order can't be shipped from anywhere",
    body: "There isn't stock for it in any place that can ship to this buyer. This is a refund or return decision, not something OpenLinker can fix.",
    action: 'Open the order and refund or return the lines that cannot ship.',
  },
  'reservation-shortfall': {
    title: 'Order {ref} is short {n} × {sku}',
    titleFallback: 'This order is short of stock',
    body: 'Your stock master dropped below what this order was promised. Nothing was silently reduced — this order is the one at risk.',
    action: 'Open the order, then check the product to see what stock is left.',
  },
  'returns-disposition-ambiguous': {
    title: 'Nothing is deciding what happens to returns from {channel}',
    titleFallback: 'Nothing is deciding what happens to these returns',
    body: 'Two systems are set up to decide, so OpenLinker is doing neither. Returns are still being recorded, but nothing is being restocked or scrapped automatically.',
    action: 'Open the connections named below and leave one of them deciding.',
  },
  // Provisional wording. The returns spec § 5.4 is the canonical owner, and
  // #2364 must converge on this string or change it here in the same commit —
  // MIRROR 6's pending pair fails the build the day it lands.
  'restock-blocked': {
    title: 'Stock was not added',
    titleFallback: 'Stock was not added',
    body: 'The system that owns this stock refused to put the returned goods back. Nothing was added, and nothing was lost.',
    action: 'Open the return to see which system refused and what it said.',
  },
  // Byte-identical to `RETURN_ORPHAN_BANNER_COPY.title` in features/returns —
  // asserted by MIRROR 6. Note the spec renders this line with a trailing
  // period and the shipped returns copy does not; the spec's own tie-break
  // ("the returns spec wins") settles it, so there is no period here.
  'return-unmatched': {
    title: 'This return is not matched to an order',
    titleFallback: 'This return is not matched to an order',
    body: 'OpenLinker has never seen the order this return belongs to, so nothing is triggered from it — no stock change, no refund, no credit note.',
    action: 'Nothing to do. If the order arrives later, OpenLinker matches it automatically.',
  },
} satisfies Record<AuthorityAttentionReason, AttentionReasonCopy>;

/** The short row label per badge code. */
export const ATTENTION_BADGE_COPY = {
  stopped: 'Stopped',
  'at-risk': 'At risk',
  blocked: 'Blocked',
  'not-matched': 'Not matched',
} satisfies Record<AuthorityAttentionBadge, string>;

/**
 * What a reason this build does not recognise renders as.
 *
 * Owned here so the table (#2354) and the row (#2356) cannot invent two
 * different sentences for it — which is the same defect §4 exists to prevent,
 * one state down. Such a row renders neutrally and is never counted.
 */
export const ATTENTION_UNKNOWN_COPY = {
  /**
   * The short row label, the counterpart to `ATTENTION_BADGE_COPY`'s four codes.
   *
   * It exists because a row badge needs SOME label and none of the four codes is
   * true of a state this build cannot name — rendering `Stopped` would be a
   * positive claim about a value we did not understand.
   */
  badgeLabel: 'Unrecognised',
  title: 'OpenLinker stopped for a reason this version does not recognise',
  body: 'This was recorded by a newer version of OpenLinker. It is kept, and it is not counted here.',
  action: 'Update OpenLinker to see what this is.',
} as const;

/** Section-level copy. #2356 must not add a second copy module for these. */
export const ATTENTION_SECTION_COPY = {
  heading: 'Needs attention',
  description: 'Things OpenLinker stopped doing, and what each one is waiting on.',
  /** Zero-state is one reassuring line, never an illustration (§4). */
  empty: 'Nothing is stuck. OpenLinker is deciding everything it was asked to.',
  /**
   * The two halves of the heading count, named rather than summed silently.
   *
   * `AuthorityAttention.counted` counts STATES (one per ambiguous authority,
   * install-wide) and `affectedOrderCount` counts ORDERS; the API's own type says
   * adding them is the caller's job because they measure different things. A bare
   * total would be a number an operator cannot act on.
   */
  statesLabel: 'Decisions not being made',
  ordersLabel: 'Orders affected',
} as const;

const PLACEHOLDER_PATTERN = /\{(channel|ref|n|sku)\}/g;

/**
 * Render one title.
 *
 * The single producer of a title string, so the section table and the row badge
 * cannot disagree.
 *
 * When any placeholder the template needs has no usable value, this returns
 * `titleFallback` rather than a sentence containing a literal `{ref}`. That
 * branch is unreachable from well-typed call sites — the params are typed — and
 * exists for values that arrive empty from the wire.
 */
export function attentionTitle(
  reason: AuthorityAttentionReason,
  params: AttentionTitleParams = {}
): string {
  const copy = ATTENTION_REASON_COPY[reason];
  let missing = false;

  const rendered = copy.title.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    const value = params[key as keyof AttentionTitleParams];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing = true;
      return '';
    }
    return String(value);
  });

  return missing ? copy.titleFallback : rendered;
}

/**
 * Every reason paired with its copy, in render order.
 *
 * Exists so a consumer never reaches for `Object.entries` of the map, whose key
 * order is not the contract.
 */
export function listAttentionReasonCopy(): readonly {
  readonly reason: AuthorityAttentionReason;
  readonly copy: AttentionReasonCopy;
}[] {
  return AuthorityAttentionReasonValues.map((reason) => ({
    reason,
    copy: ATTENTION_REASON_COPY[reason],
  }));
}
