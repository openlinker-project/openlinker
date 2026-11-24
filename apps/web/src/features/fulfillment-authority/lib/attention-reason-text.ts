/**
 * Attention-Reason Text
 *
 * Every operator-facing string for spec §4.2's inert states. The words live in
 * the `fulfillment-authority.attention` block of `locales/<lang>/<namespace>.json`
 * (ADR-081, #3875); this module keeps the exported names and shapes the row
 * badges, the `Needs attention` section and the orders / products pages read,
 * each one reading the active language when it is read.
 *
 * ## One source, because two surfaces describe one state
 *
 * §4 requires an inert state to appear in `Needs attention` AND on the row the
 * operator is already looking at, with the SAME title. Every title is produced
 * through {@link attentionTitle}; a renderer that assembles a title itself has
 * reintroduced the defect.
 *
 * Render order comes from `AuthorityAttentionReasonValues`, never the key order
 * of the copy, which the locale file sorts.
 *
 * ## RB-L and OR-P are owned by the returns spec
 *
 * `scripts/check-attention-reason-mirror.mjs` MIRROR 6 asserts the OR-P title
 * equals `returns.detail.orphanBanner.title` and the RB-L title equals
 * `returns.restockBlocked.title`; MIRROR 7 holds a placeholder-free `title`
 * equal to its own `titleFallback`. Editing either field alone fails the build.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 4.2 / § 4.3
 */

import { getMessages } from '../../../shared/i18n';
import {
  AuthorityAttentionReasonValues,
  type AuthorityAttentionBadge,
  type AuthorityAttentionReason,
} from './attention-reason';
import { lazyCopy } from './lazy-copy';

/**
 * The placeholders a title template may carry. `{n}` is a count, so a number
 * is accepted directly.
 */
export interface AttentionTitleParams {
  readonly channel?: string;
  readonly ref?: string;
  readonly n?: string | number;
  readonly sku?: string;
}

export interface AttentionReasonCopy {
  /** May carry `{channel}` / `{ref}` / `{n}` / `{sku}`. Never rendered raw - go through {@link attentionTitle}. */
  readonly title: string;
  /**
   * A complete, placeholder-free sentence used when a placeholder the template
   * needs has no value. A placeholder-free title repeats itself here.
   */
  readonly titleFallback: string;
  readonly body: string;
  /** What the operator can do. Operator copy - never the spec's implementer-facing Fix note. */
  readonly action: string;
}

const attention = (): ReturnType<typeof getMessages<'fulfillment-authority'>>['attention'] =>
  getMessages('fulfillment-authority').attention;

/** One entry per reason; the locale file must hold every reason (checked by the type below). */
export const ATTENTION_REASON_COPY: Readonly<Record<AuthorityAttentionReason, AttentionReasonCopy>> =
  lazyCopy(() => attention().reasons);

/** The short row label per badge code. */
export const ATTENTION_BADGE_COPY: Readonly<Record<AuthorityAttentionBadge, string>> = lazyCopy(
  () => attention().badges
);

/**
 * What a reason this build does not recognise renders as - owned here so the
 * table and the row cannot invent two different sentences for it.
 */
export const ATTENTION_UNKNOWN_COPY: Readonly<{
  badgeLabel: string;
  title: string;
  body: string;
  action: string;
}> = lazyCopy(() => attention().unknown);

/** Section-level copy. */
export const ATTENTION_SECTION_COPY: Readonly<{
  heading: string;
  description: string;
  empty: string;
  statesLabel: string;
  ordersLabel: string;
  unknownNote: string;
}> = lazyCopy(() => attention().section);

const PLACEHOLDER_PATTERN = /\{(channel|ref|n|sku)\}/g;

/**
 * Render one title - the single producer of a title string, so the section
 * table and the row badge cannot disagree. A placeholder with no usable value
 * returns `titleFallback` rather than a sentence containing a literal `{ref}`.
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

/** Every reason paired with its copy, in render order (never the copy's key order). */
export function listAttentionReasonCopy(): readonly {
  readonly reason: AuthorityAttentionReason;
  readonly copy: AttentionReasonCopy;
}[] {
  return AuthorityAttentionReasonValues.map((reason) => ({
    reason,
    copy: ATTENTION_REASON_COPY[reason],
  }));
}
