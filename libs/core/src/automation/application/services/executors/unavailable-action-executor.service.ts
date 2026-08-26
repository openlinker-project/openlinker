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
import type { AutomationActionKind } from '../../../domain/types/automation-action.types';
import type { AutomationStepResult } from '../../../domain/types/automation-step-result.types';

/**
 * Why each unavailable action cannot run, in operator-facing words that name
 * the blocking work. One entry per registered-but-unavailable action.
 */
export const AUTOMATION_UNAVAILABLE_ACTION_REASONS = {
  'issue-sales-document':
    'Issuing a sales document from an automation needs an order-shaped read that OpenLinker does not ' +
    'ship yet: the auto-issue entry point takes a full order, and only order ingestion holds one. ' +
    'Issue the document from the order page until that read lands.',
  'dispatch-shipment':
    'Buying a shipping label from an automation needs a recipient and parcel that cannot be derived ' +
    'from a stored order, and package presets do not exist yet. Buy the label from the order page.',
  'place-hold':
    'Order holds are not built yet (#2339), so an automation cannot place one. Hold the order from the order page.',
  'release-hold':
    'Order holds are not built yet (#2339), so an automation cannot lift one. Lift the hold from the order page.',
} as const satisfies Partial<Record<AutomationActionKind, string>>;

export type AutomationUnavailableAction = keyof typeof AUTOMATION_UNAVAILABLE_ACTION_REASONS;

@Injectable()
export class UnavailableActionExecutorService implements AutomationActionExecutorPort {
  private readonly logger = new Logger(UnavailableActionExecutorService.name);

  execute(input: AutomationActionExecutionInput): Promise<AutomationStepResult> {
    const action = input.action.action;
    const reason =
      action in AUTOMATION_UNAVAILABLE_ACTION_REASONS
        ? AUTOMATION_UNAVAILABLE_ACTION_REASONS[action as AutomationUnavailableAction]
        : `Action "${action}" has no executor in this build.`;

    this.logger.warn(
      `Automation "${input.rule.name}" (${input.rule.id}) step ${input.stepIndex} ` +
        `(${action}) did not run: ${reason}`,
    );

    return Promise.resolve({
      stepIndex: input.stepIndex,
      action,
      status: 'failed',
      detail: reason,
      unavailableReason: reason,
    });
  }
}
