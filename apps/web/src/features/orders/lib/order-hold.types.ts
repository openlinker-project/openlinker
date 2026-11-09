/**
 * Order Hold Vocabulary + Operator Copy Accessors (#2342)
 *
 * The frontend mirror of `HoldReasonValues` (`@openlinker/core/order-lifecycle`,
 * #2305 / ADR-059) plus the operator-facing copy for each reason and for the
 * three `provisioningResume` outcomes a release can report (#2341).
 *
 * **Why a mirror rather than an import.** `apps/web` has no dependency on
 * `@openlinker/core` (#591) — the browser bundle cannot reach it. A copy drifts
 * silently in both directions: a reason added only to core never reaches the
 * select, and one added only here type-checks against a value the API will never
 * send. `scripts/check-hold-reason-mirror.mjs` compares the two arrays
 * value-for-value AND in order, under `pnpm check:invariants`.
 *
 * **Why the copy accessors live beside the union.** Both halves change together -
 * adding a reason means writing its label in `locales/en/orders.json` in the same
 * commit, which the `Record<HoldReason, …>` annotation in `holdReasonCopy`
 * enforces. The words live in the `orders.holds` namespace and are read when a
 * function is called, so they follow the active language.
 *
 * @module apps/web/src/features/orders/lib
 */

import { getMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';

/**
 * The eight hold reasons. **Order-sensitive** — the mirror guard compares
 * position as well as membership, matching `check-order-lifecycle-phase-mirror`.
 */
export const HoldReasonValues = [
  'payment-review',
  'fraud-review',
  'operator',
  'stock-shortfall',
  'address-invalid',
  'awaiting-amendment',
  'awaiting-customer-confirmation',
  'external',
] as const;

export type HoldReason = (typeof HoldReasonValues)[number];

/**
 * Coerce an untrusted value (a `?hold=` search param, an `activeHoldReason`
 * from an API this build does not fully know) to the union.
 *
 * No default. An unrecognised reason must read as "not a hold reason" rather
 * than silently becoming `operator`, which would attribute a machine's hold to
 * a human — the same rule the core guard states.
 */
export function isHoldReason(value: unknown): value is HoldReason {
  return typeof value === 'string' && (HoldReasonValues as readonly string[]).includes(value);
}

export interface HoldReasonCopy {
  /** Badge / select label. Short enough for a status pill (~17 chars). */
  label: string;
  /** One sentence an operator can act on. Rendered as the badge `title`. */
  hint: string;
}

type HoldsCopy = ResolvedCopy<Messages['orders']>['holds'];

/**
 * Copy per reason, from the `orders.holds.reasons` namespace, read when called
 * so it follows the active language.
 *
 * The `Record<HoldReason, …>` annotation is the point: a reason added to the
 * mirror without copy in `en.json` is a compile error here, never a silently
 * unlabelled badge - the `BADGE_BY_REASON` precedent in `order-row.ts`.
 */
export function holdReasonCopy(reason: HoldReason): HoldReasonCopy {
  const reasons: Record<HoldReason, HoldReasonCopy> = getMessages('orders').holds.reasons;
  return reasons[reason];
}

/** Label for a reason, or the raw value when this build does not recognise it. */
export function holdReasonLabel(reason: string): string {
  return isHoldReason(reason) ? holdReasonCopy(reason).label : reason;
}

/** Hint for a reason; a reason this build does not recognise gets the generic one. */
export function holdReasonHint(reason: string): string {
  return isHoldReason(reason)
    ? holdReasonCopy(reason).hint
    : getMessages('orders').holds.unrecognisedHint;
}

/**
 * What OpenLinker did about the provisioning run the released hold had been
 * suppressing (#2341). Mirrors `ProvisioningResumeDto`.
 *
 * Every field is independently nullable because the backend reports rather than
 * assumes - a 2xx here does not mean the order is moving again.
 */
export interface ProvisioningResume {
  status: 'enqueued' | 'skipped' | 'failed';
  jobId?: string | null;
  reason?: string | null;
}

export interface ProvisioningResumeCopy {
  tone: 'success' | 'warning';
  /** Sentence appended to the release confirmation. */
  message: string;
}

/**
 * Why nothing was enqueued. `skipped` reasons describe a HEALTHY order (it has
 * no source-side job to run at all); `enqueue-failed` is the one that leaves the
 * order un-provisioned and needs the operator.
 *
 * Deliberately loose (keyed by the raw string): a skip reason added backend-side
 * falls through to the generic "nothing to restart" sentence, which stays TRUE
 * of any `skipped` - so the cost of drift here is a less specific sentence, not
 * a wrong one.
 */
function skippedMessage(reason: string | null | undefined, copy: HoldsCopy['resume']): string {
  switch (reason) {
    case 'order-not-found':
      return copy.skippedOrderNotFound;
    case 'missing-source-external-id':
      return copy.skippedMissingSourceExternalId;
    case 'enqueue-failed':
      return copy.skippedEnqueueFailed;
    default:
      return copy.skippedGeneric;
  }
}

/**
 * Collapse a `provisioningResume` into one operator sentence + a tone.
 *
 * **`failed` must never read as a plain success.** The hold is gone AND the
 * order is still un-provisioned, with no scheduled task that will pick up this
 * one order - so the copy names the remedy (the existing per-destination Retry
 * action) instead of implying the work resumed. An absent `resume` (an API
 * predating #2341) reports the release only, and never invents `enqueued`.
 */
export function describeProvisioningResume(
  resume: ProvisioningResume | null | undefined,
): ProvisioningResumeCopy {
  const copy = getMessages('orders').holds.resume;
  if (!resume) return { tone: 'success', message: copy.released };

  switch (resume.status) {
    case 'enqueued':
      return { tone: 'success', message: copy.enqueued };
    case 'skipped':
      return { tone: 'success', message: skippedMessage(resume.reason, copy) };
    // `failed` and any status this build does not recognise. Grouping them is
    // the fail-safe direction: an unknown status must not be reported as a
    // success, because the one thing that is certain is that OL did not
    // observe the order start moving again.
    case 'failed':
    default:
      return { tone: 'warning', message: copy.failed };
  }
}

/**
 * A cancel the sales channel reported releases the hold as OpenLinker itself: no
 * releasing user, and the cancel note. Mirrors `ORDER_CANCELLED_HOLD_RELEASE_NOTE`
 * (the browser cannot import core, #591); an unrecognised note just reads as an
 * unattributed release, which is the pre-existing behaviour.
 */
const ORDER_CANCELLED_HOLD_RELEASE_NOTE = 'order cancelled';

export function isReleasedByOrderCancel(hold: {
  releasedAt: string | null;
  releasedByUserId: string | null;
  releaseNote: string | null;
}): boolean {
  return (
    hold.releasedAt !== null &&
    !hold.releasedByUserId &&
    hold.releaseNote === ORDER_CANCELLED_HOLD_RELEASE_NOTE
  );
}
