/**
 * Automation Action Availability (#2363, Wave-2 spec §5.3)
 *
 * Whether each of the six v1 actions can actually RUN in this build, and — when
 * it cannot, or can only sometimes — why, in operator-facing words that name the
 * blocking work.
 *
 * ## Why this table exists at all
 *
 * The §5.4 legality matrix answers *"may this action follow this trigger?"*. It
 * says nothing about whether OpenLinker ships the operation. Five of the six
 * actions cannot run today, and the write path deliberately ACCEPTS all six
 * (#2361 registers the unavailable executors rather than omitting them, so a
 * firing is loud rather than silent). Without this table the API would present
 * six ready actions, the operator would arm one, and the only signal would be a
 * failed run — the silent-decline defect class this programme keeps closing.
 *
 * ## One table, three consumers — so what is REPORTED is what is ENFORCED
 *
 * The #2229 rule, applied here: `UnavailableActionExecutorService` and
 * `SendEmailExecutorService` take their operator-facing copy FROM this table
 * rather than holding their own literals, and #2363's `/automations/vocabulary`
 * reports the same strings. A composer that says "not built yet" and an executor
 * that says something else about the same action is worse than either alone,
 * because the operator cannot tell which one is lying.
 *
 * ## Three values, because the truth is three-valued
 *
 * `partial` is not hedging. `MAILER_TOKEN` is bound only in `apps/api`, and
 * automation fires from BOTH processes — the T5 `order.packed` edge from the API
 * write site, the T4 deadline sweep from the worker. So A4 genuinely works for
 * one trigger and genuinely does not for another. Calling it `available` is
 * false for the sweep; calling it `unavailable` is false for the pack. The
 * reason string names which is which, so an operator reads a fact rather than a
 * hedge.
 *
 * The pure-rule exception (`engineering-standards.md § The pure-rule exception`)
 * admits `availabilityForAction` here: it is pure, it IS the rule for this type,
 * and a seventh action added to `AutomationActionValues` must edit both halves
 * in one commit — which the `satisfies` makes a compile error rather than an
 * action that silently reads as ready.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.3
 */
import type { AutomationActionKind } from './automation-action.types';

/**
 * How reachable an action's underlying operation is in this build.
 *
 * - `available`   — ships end-to-end and runs wherever automation fires.
 * - `partial`     — ships, but only in some firing processes. `reason` says which.
 * - `unavailable` — the operation does not exist yet. `reason` names the blocking work.
 */
export const AutomationActionAvailabilityValues = [
  'available',
  'partial',
  'unavailable',
] as const;
export type AutomationActionAvailability =
  (typeof AutomationActionAvailabilityValues)[number];

/** Coerce an untrusted value to the availability union. No default. */
export function isAutomationActionAvailability(
  value: unknown,
): value is AutomationActionAvailability {
  return (
    typeof value === 'string' &&
    (AutomationActionAvailabilityValues as readonly string[]).includes(value)
  );
}

export interface AutomationActionAvailabilityEntry {
  readonly availability: AutomationActionAvailability;
  /** `null` if and only if `availability === 'available'`. */
  readonly reason: string | null;
}

/**
 * The declared availability of each action. Total over `AutomationActionKind`.
 *
 * The four `unavailable` reasons were established by grepping the live tree
 * during #2361, not assumed — see `UnavailableActionExecutorService`'s docblock
 * for the per-action evidence.
 */
export const AUTOMATION_ACTION_AVAILABILITY = {
  'issue-sales-document': {
    availability: 'unavailable',
    reason:
      'Issuing a sales document from an automation needs an order-shaped read that OpenLinker does not ' +
      'ship yet: the auto-issue entry point takes a full order, and only order ingestion holds one. ' +
      'Issue the document from the order page until that read lands.',
  },
  'dispatch-shipment': {
    availability: 'unavailable',
    reason:
      'Buying a shipping label from an automation needs a recipient and parcel that cannot be derived ' +
      'from a stored order, and package presets do not exist yet. Buy the label from the order page.',
  },
  'relay-status-to-source': { availability: 'available', reason: null },
  'send-email': {
    availability: 'partial',
    reason:
      'Automation emails currently require the API process. A rule on a trigger that fires from the ' +
      'background worker — the dispatch-deadline sweep — will report a failed step instead of sending.',
  },
  'place-hold': {
    availability: 'unavailable',
    reason:
      'Order holds are not built yet (#2339), so an automation cannot place one. Hold the order from the order page.',
  },
  'release-hold': {
    availability: 'unavailable',
    reason:
      'Order holds are not built yet (#2339), so an automation cannot lift one. Lift the hold from the order page.',
  },
} as const satisfies Record<AutomationActionKind, AutomationActionAvailabilityEntry>;

/** This build's availability for one action. */
export function availabilityForAction(
  action: AutomationActionKind,
): AutomationActionAvailabilityEntry {
  return AUTOMATION_ACTION_AVAILABILITY[action];
}

/**
 * The reason an action cannot run, or `null` where it can.
 *
 * Tolerates an untrusted `action`: the executors are keyed from a PERSISTED
 * `jsonb` column, so a rule saved by a newer build and read by an older one can
 * name an action this table does not know. An unknown action has no declared
 * reason, and the caller supplies its own — reporting a guessed one would be a
 * claim about work nobody scheduled.
 */
export function unavailableReasonForAction(action: string): string | null {
  const entry: AutomationActionAvailabilityEntry | undefined = (
    AUTOMATION_ACTION_AVAILABILITY as Record<string, AutomationActionAvailabilityEntry>
  )[action];
  return entry?.reason ?? null;
}
