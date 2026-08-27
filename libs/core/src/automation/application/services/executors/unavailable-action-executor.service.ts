/**
 * Unavailable Action Executor (#2361)
 *
 * The executor for an action whose underlying operation OpenLinker does not yet
 * ship. It runs nothing and returns a `failed` step naming the blocking gap.
 *
 * ## Why these actions are REGISTERED rather than omitted
 *
 * The write path already accepts all six actions (#2359's legality matrix), so
 * an operator can save such a rule today. A missing registry entry would make
 * the firing silent — the exact defect class this programme keeps closing.
 * Failing loudly, with the blocking issue named, is what lets an operator tell
 * "not built yet" from "it broke".
 *
 * ## What is actually missing, per action
 *
 * Established by grepping the live tree, not assumed:
 *
 * - **A1 `issue-sales-document`** — `AutoIssueTriggerService.onOrderTransition`
 *   takes an `Order` and reads `order.items` / `order.totals`; its only caller
 *   is `OrderIngestionService`, which already holds one. An automation holds an
 *   id. `OrderRecord.orderSnapshot` does hold the resolved `Order`, but it is
 *   `Record<string, unknown>` and JSONB round-trips `Order.placedAt` from `Date`
 *   to an ISO STRING — so a cast type-checks and is silently wrong downstream.
 *   A faithful reconstruction is a deserializer with date revival, owned by the
 *   `orders` context.
 * - **A2 `dispatch-shipment`** — `ShipmentDispatchInput` requires `recipient`
 *   and `parcel`, which its own file header documents as not derivable from a
 *   persisted order, and carries no `carrierId` / `serviceId` /
 *   `packagePresetId`. Package presets do not exist anywhere in the tree.
 * - **A5 `place-hold` / A6 `release-hold`** — `order-lifecycle` is a
 *   vocabulary-only leaf. No `order_holds` table, service or token exists.
 *   #2338/#2339 have not landed.
 *
 * @module libs/core/src/automation/application/services/executors
 * @implements {AutomationActionExecutorPort}
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import type {
  AutomationActionExecutionInput,
  AutomationActionExecutorPort,
} from '../../../domain/ports/automation-action-executor.port';
import { AutomationActionValues } from '../../../domain/types/automation-action.types';
import {
  AUTOMATION_ACTION_AVAILABILITY,
  unavailableReasonForAction,
} from '../../../domain/types/automation-action-availability.types';
import { ATTRIBUTION_OPENLINKER } from '../../../domain/types/automation-step-result.types';
import type { AutomationStepResult } from '../../../domain/types/automation-step-result.types';

/**
 * Why each unavailable action cannot run, in operator-facing words that name the
 * blocking work.
 *
 * **Derived from `AUTOMATION_ACTION_AVAILABILITY` (#2363), not restated.** The
 * same strings are reported by `/automations/vocabulary`, so what an operator is
 * told at AUTHORING time and what they are told at FIRING time are the same
 * sentence by construction — the #2229 "reported === enforced" rule. Two copies
 * is how a composer that says "not built yet" ends up beside an executor that
 * says something else about the same action, and the operator cannot tell which
 * one is lying.
 *
 * Kept as a named export because it is this file's published surface; only its
 * source moved.
 */
export const AUTOMATION_UNAVAILABLE_ACTION_REASONS = Object.fromEntries(
  AutomationActionValues.filter(
    (action) => AUTOMATION_ACTION_AVAILABILITY[action].availability === 'unavailable',
  ).map((action) => [action, AUTOMATION_ACTION_AVAILABILITY[action].reason]),
) as Readonly<Record<string, string>>;

@Injectable()
export class UnavailableActionExecutorService implements AutomationActionExecutorPort {
  private readonly logger = new Logger(UnavailableActionExecutorService.name);

  execute(input: AutomationActionExecutionInput): Promise<AutomationStepResult> {
    const action = input.action.action;
    // An action with no DECLARED reason is one this build does not recognise at
    // all (a rule saved by a newer build). Reporting a guessed reason would be a
    // claim about work nobody scheduled, so the fallback says only what is known.
    const reason =
      unavailableReasonForAction(action) ?? `Action "${action}" has no executor in this build.`;

    this.logger.warn(
      `Automation "${input.rule.name}" (${input.rule.id}) step ${input.stepIndex} ` +
        `(${action}) did not run: ${reason}`,
    );

    return Promise.resolve({
      stepIndex: input.stepIndex,
      action,
      status: 'failed',
      detail: reason,
      // OpenLinker's own statement about its own build (#2387) — no external
      // operation was reached, so there is nobody else to attribute it to.
      report: { attributedTo: ATTRIBUTION_OPENLINKER, message: reason },
      unavailableReason: reason,
    });
  }
}
