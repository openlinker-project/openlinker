/**
 * Order Hold Vocabulary + Operator Copy (#2342)
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
 * **Why the copy tables live beside the union.** Both halves change together —
 * adding a reason means writing its label in the same commit, which is exactly
 * what `satisfies Record<HoldReason, …>` enforces. That is the pure-rule
 * exception in `engineering-standards.md § The pure-rule exception to "types
 * only"`, and the same shape as `order-lifecycle-phase.types.ts` next door:
 * pure, no I/O, no dependency, and it IS the rule for the type it sits with.
 *
 * @module apps/web/src/features/orders/lib
 */

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

/**
 * Copy per reason.
 *
 * `satisfies Record<HoldReason, …>` is the point: a reason added to the mirror
 * without copy is a compile error here, never a silently unlabelled badge —
 * the `BADGE_BY_REASON` precedent in `order-row.ts`.
 */
export const HOLD_REASON_COPY = {
  'payment-review': {
    label: 'Payment review',
    hint: 'Payment is being verified before this order goes any further.',
  },
  'fraud-review': {
    label: 'Fraud review',
    hint: 'A risk check on this order is still outstanding.',
  },
  operator: {
    label: 'Held by operator',
    hint: 'Someone paused this order deliberately. See the note for why.',
  },
  'stock-shortfall': {
    label: 'Stock shortfall',
    hint: 'The quantity this order needs is not actually available to pick.',
  },
  'address-invalid': {
    label: 'Address invalid',
    hint: 'The delivery address failed validation, so this order cannot be shipped.',
  },
  'awaiting-amendment': {
    label: 'Awaiting change',
    hint: 'A change to this order is outstanding and has not been applied yet.',
  },
  'awaiting-customer-confirmation': {
    label: 'Awaiting buyer',
    hint: 'The buyer, not the shop, is what this order is waiting on.',
  },
  external: {
    label: 'Held by channel',
    hint: 'The sales channel is holding this order for a reason OpenLinker cannot classify.',
  },
} satisfies Record<HoldReason, HoldReasonCopy>;

/** Label for a reason, or the raw value when this build does not recognise it. */
export function holdReasonLabel(reason: string): string {
  return isHoldReason(reason) ? HOLD_REASON_COPY[reason].label : reason;
}

/**
 * What OpenLinker did about the provisioning run the released hold had been
 * suppressing (#2341). Mirrors `ProvisioningResumeDto`.
 *
 * Every field is independently nullable because the backend reports rather than
 * assumes — a 2xx here does not mean the order is moving again.
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
 * Deliberately a loose `Record<string, string>`, unlike `HOLD_REASON_COPY`
 * above: a skip reason added backend-side falls through to the generic
 * "nothing to restart" sentence, which stays TRUE of any `skipped` — so the
 * cost of drift here is a less specific sentence, not a wrong one. Mirroring
 * the core union would buy a second guard script for a two-value list.
 */
const RESUME_REASON_COPY: Record<string, string> = {
  'order-not-found': 'There is no source record to re-sync.',
  'missing-source-external-id': 'This order has no channel reference to re-sync from.',
  'enqueue-failed': 'OpenLinker could not restart it.',
};

/**
 * Collapse a `provisioningResume` into one operator sentence + a tone.
 *
 * **`failed` must never read as a plain success.** The hold is gone AND the
 * order is still un-provisioned, with no scheduled task that will pick up this
 * one order — so the copy names the remedy (the existing per-destination Retry
 * action) instead of implying the work resumed. An absent `resume` (an API
 * predating #2341) reports the release only, and never invents `enqueued`.
 */
export function describeProvisioningResume(
  resume: ProvisioningResume | null | undefined,
): ProvisioningResumeCopy {
  if (!resume) return { tone: 'success', message: 'Hold released.' };

  switch (resume.status) {
    case 'enqueued':
      return { tone: 'success', message: 'Hold released. Sending this order on is queued.' };
    case 'skipped': {
      const why = resume.reason ? RESUME_REASON_COPY[resume.reason] : undefined;
      return {
        tone: 'success',
        message: why
          ? `Hold released. Nothing to restart — ${why.charAt(0).toLowerCase()}${why.slice(1)}`
          : 'Hold released. There was nothing to restart.',
      };
    }
    // `failed` and any status this build does not recognise. Grouping them is
    // the fail-safe direction: an unknown status must not be reported as a
    // success, because the one thing that is certain is that OL did not
    // observe the order start moving again.
    case 'failed':
    default:
      return {
        tone: 'warning',
        message:
          'Hold released, but this order did not restart. Use Retry on its destination to send it on.',
      };
  }
}
