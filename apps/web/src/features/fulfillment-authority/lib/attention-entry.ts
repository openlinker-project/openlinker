/**
 * Attention Entry View Model
 *
 * The pure coercion from ONE untrusted inert-state entry — a row's persisted
 * `omsAttention` element, or an item off the status payload's `attention.counted`
 * — into what a surface draws.
 *
 * ## Why a coercion rather than a type
 *
 * The wire carries a `reason` string this build may not recognise: a value
 * written by a newer release and then rolled back, or a persisted jsonb row from
 * a future version. Spec §4.4 S2-5 says such a row renders NEUTRALLY and is
 * never counted — so the discriminant here is `known`, and every consumer that
 * counts must filter on it rather than on array length.
 *
 * ## Why the title is produced here and never assembled
 *
 * §4 requires an inert state to read the same in `Needs attention` and on the
 * operator's own row. {@link attentionTitle} is the single producer of a title
 * string (#2357); this function is the single place that CALLS it for an entry,
 * so the section table, the row badge and #2355's confirm dialog cannot disagree
 * about one state. A renderer that reaches for `ATTENTION_REASON_COPY[...].title`
 * itself has reintroduced the defect the copy module exists to prevent.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 4.2 / § 4.3
 */

import {
  ATTENTION_REASON_COPY,
  ATTENTION_UNKNOWN_COPY,
  attentionTitle,
  type AttentionTitleParams,
} from './attention-reason.copy';
import {
  ATTENTION_REASON_MIRROR,
  attentionBadgeTone,
  isAuthorityAttentionReason,
  type AuthorityAttentionBadge,
  type AuthorityAttentionReason,
} from './attention-reason';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

/**
 * One inert state as a row carries it.
 *
 * Mirrors core's `AuthorityAttentionEntry`. Every field except `reason` is read
 * defensively — this shape arrives from a jsonb column, so a consumer must not
 * assume the writer's version matches the reader's.
 */
export interface AttentionEntryInput {
  readonly reason?: unknown;
  readonly detail?: unknown;
  readonly subjectRef?: unknown;
  readonly since?: unknown;
  readonly producer?: unknown;
}

/** A state this build understands. */
export interface KnownAttentionEntryView {
  readonly known: true;
  readonly reason: AuthorityAttentionReason;
  readonly badge: AuthorityAttentionBadge;
  readonly tone: StatusBadgeTone;
  /** Produced by {@link attentionTitle}. Never assembled by a renderer. */
  readonly title: string;
  readonly body: string;
  readonly action: string;
  /** PII-free elaboration the backend wrote, rendered verbatim or not at all. */
  readonly detail: string | null;
  readonly since: string | null;
}

/**
 * A state this build does not understand.
 *
 * Deliberately carries no badge and no tone: a neutral rendering is the honest
 * one, and inventing a tone would let an unrecognised value shout.
 */
export interface UnknownAttentionEntryView {
  readonly known: false;
  /** The raw value, so an operator can quote it in a support ticket. */
  readonly rawReason: string | null;
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly detail: string | null;
  readonly since: string | null;
}

export type AttentionEntryView = KnownAttentionEntryView | UnknownAttentionEntryView;

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Coerce one entry.
 *
 * `params` carries the placeholder values a title template may need (`{ref}`,
 * `{n}`, `{sku}`, `{channel}`). Absent values are not an error: `attentionTitle`
 * falls back to a complete, placeholder-free sentence rather than rendering a
 * literal `{ref}` at an operator.
 */
export function toAttentionEntryView(
  entry: AttentionEntryInput,
  params: AttentionTitleParams = {}
): AttentionEntryView {
  const detail = readOptionalString(entry.detail);
  const since = readOptionalString(entry.since);

  if (!isAuthorityAttentionReason(entry.reason)) {
    return {
      known: false,
      rawReason: readOptionalString(entry.reason),
      title: ATTENTION_UNKNOWN_COPY.title,
      body: ATTENTION_UNKNOWN_COPY.body,
      action: ATTENTION_UNKNOWN_COPY.action,
      detail,
      since,
    };
  }

  const reason = entry.reason;
  const badge = ATTENTION_REASON_MIRROR[reason].badge;
  const copy = ATTENTION_REASON_COPY[reason];

  return {
    known: true,
    reason,
    badge,
    tone: attentionBadgeTone(badge),
    title: attentionTitle(reason, params),
    body: copy.body,
    action: copy.action,
    detail,
    since,
  };
}

/**
 * How many of these entries the `Needs attention (N)` count may include.
 *
 * An unrecognised entry is EXCLUDED (spec §4.4 S2-5). Counting one would make
 * the number describe something the surface cannot then explain — the same
 * silent-decline defect #2100 § 54 forbids, one vocabulary down.
 *
 * Every shipped reason is `counted: true` today, so the mirror lookup
 * discriminates nothing among KNOWN entries and is read anyway: the flag is the
 * contract, and hard-coding "all known entries count" would silently
 * over-report the day a routine reason is added.
 */
export function countAttentionEntries(views: readonly AttentionEntryView[]): number {
  return views.filter((view) => view.known && ATTENTION_REASON_MIRROR[view.reason].counted).length;
}
