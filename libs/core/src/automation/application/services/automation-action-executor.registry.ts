/**
 * Automation Action Executor Registry (#2361, spec §5.3)
 *
 * Maps each of the six v1 actions to the executor that runs it. `satisfies`
 * makes the map TOTAL: a seventh action added to `AutomationActionValues` is a
 * compile error here rather than a rule that saves and silently never runs.
 *
 * ## The four PRUNED actions, and why each stays pruned (spec §5.3)
 *
 * Recorded here so they are not re-proposed. None of them is absent by oversight.
 *
 * - **`mark-packed`** — cut ON PRINCIPLE. `packedAt` + `packedByUserId` record
 *   that A NAMED HUMAN PACKED A PHYSICAL BOX. An automation writing it would put
 *   a user id (or a null) against an event that did not happen, and the column's
 *   entire value is that it is trustworthy. Automating an assertion about the
 *   physical world is the one thing this layer must never do.
 * - **`propose-credit-note`** — deferred to v1.1. The correction proposal (T7) is
 *   real Wave-2 functionality, but the design requires it to render its
 *   positional ambiguity for operator confirmation and never auto-issue. An
 *   automation creating confirmable proposals is defensible; it needs the
 *   proposal inbox UI first, which is not in Wave 2's scope.
 * - **`adjust-stock` / `restock`** — cut. Restock is already the automatic
 *   consequence of disposition (T5); a second path to the same write is how
 *   double-restock bugs get built.
 * - **`call-a-webhook`** — cut; see §6 non-goals.
 *
 * @module libs/core/src/automation/application/services
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.3
 */
import { Injectable } from '@nestjs/common';

import type { AutomationActionExecutorPort } from '../../domain/ports/automation-action-executor.port';
import type { AutomationActionKind } from '../../domain/types/automation-action.types';
import { RelayStatusToSourceExecutorService } from './executors/relay-status-to-source-executor.service';
import { SendEmailExecutorService } from './executors/send-email-executor.service';
import { UnavailableActionExecutorService } from './executors/unavailable-action-executor.service';

@Injectable()
export class AutomationActionExecutorRegistry {
  private readonly byAction: Record<AutomationActionKind, AutomationActionExecutorPort>;

  constructor(
    relayStatus: RelayStatusToSourceExecutorService,
    sendEmail: SendEmailExecutorService,
    unavailable: UnavailableActionExecutorService,
  ) {
    this.byAction = {
      // A1/A2/A5/A6 have no operation an automation can reach — the reasons are
      // on `UnavailableActionExecutorService`, which reports each one by name.
      'issue-sales-document': unavailable,
      'dispatch-shipment': unavailable,
      'relay-status-to-source': relayStatus,
      'send-email': sendEmail,
      'place-hold': unavailable,
      'release-hold': unavailable,
    } satisfies Record<AutomationActionKind, AutomationActionExecutorPort>;
  }

  /**
   * The executor for an action, or `undefined` for an action this build does not
   * know. Unreachable through the type system, but the registry is keyed from a
   * PERSISTED `jsonb` column: a rule saved by a newer build and read by an older
   * one is exactly the case the caller's defensive arm exists for.
   */
  resolve(action: AutomationActionKind): AutomationActionExecutorPort | undefined {
    return this.byAction[action] as AutomationActionExecutorPort | undefined;
  }

  /** Every action this registry covers — used by the boot gate. */
  coveredActions(): readonly AutomationActionKind[] {
    return Object.keys(this.byAction) as AutomationActionKind[];
  }
}
