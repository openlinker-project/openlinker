/**
 * A3 — Relay Status To Source Executor (#2361, spec §5.3b A3)
 *
 * *"Tell the marketplace"*. Delegates to the shipped `OrderStatusWriteback`
 * relay (#1157, ADR-027) and adds nothing: the relay already resolves each
 * participant's own `externalOrderId`, is best-effort per target, and never
 * throws for one participant.
 *
 * **This is the one action that maps cleanly onto a shipped operation**, and the
 * reason is its input: it needs only the internal order id, which the trigger
 * facts already carry. Every other action needs data an automation cannot
 * obtain (see `UnavailableActionExecutorService`).
 *
 * **A3 takes no parameters, deliberately** (§5.3b): OpenLinker relays what it
 * knows. Inventing a status picker would be the "states yes" boundary the design
 * refuses, and the relay's event union carries no status the operator could pick
 * from anyway.
 *
 * @module libs/core/src/automation/application/services/executors
 * @implements {AutomationActionExecutorPort}
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import type { IOrderLifecycleRelayService } from '@openlinker/core/orders';

import type {
  AutomationActionExecutionInput,
  AutomationActionExecutorPort,
} from '../../../domain/ports/automation-action-executor.port';
import type { AutomationStepResult } from '../../../domain/types/automation-step-result.types';
import { AutomationDelegateResolverService } from '../automation-delegate-resolver.service';

/**
 * The origin OpenLinker relays under when the operator (not a participant)
 * caused the event.
 *
 * **`originConnectionId` EXCLUDES that participant from the relay's targets.**
 * Passing the order's own `sourceConnectionId` here would therefore suppress
 * exactly the marketplace A3 exists to notify — the action would report success
 * and tell nobody. An automation has no participant origin, so it passes a
 * sentinel that matches no connection and excludes nothing.
 *
 * This mirrors `ShipmentDispatchNotificationService`, which passes the CARRIER
 * connection for the same reason: a carrier is never an order participant, so
 * it excludes nothing and the relay reaches the source plus all destinations.
 */
export const AUTOMATION_RELAY_ORIGIN = 'openlinker:automation';

// The relay contract is imported TYPE-ONLY. A type import erases at build time,
// so it adds no runtime edge and cannot close the CJS barrel cycle the lazy
// `require` in `AutomationDelegateResolverService` exists to avoid — the same
// carve-out `sales-documents` and `order-lifecycle` hold. Binding to the real
// contract rather than a hand-written structural mirror is what makes an
// upstream signature change a compile error here instead of a runtime failure
// inside a job.

@Injectable()
export class RelayStatusToSourceExecutorService implements AutomationActionExecutorPort {
  private readonly logger = new Logger(RelayStatusToSourceExecutorService.name);

  constructor(private readonly delegates: AutomationDelegateResolverService) {}

  async execute(input: AutomationActionExecutionInput): Promise<AutomationStepResult> {
    const step = { stepIndex: input.stepIndex, action: 'relay-status-to-source' } as const;

    // T6/T7 fire on returns, and the relay is keyed on an internal ORDER.
    // Reporting that plainly beats relaying against a return id the relay would
    // fail to resolve — the legality matrix permits T7 -> A3, so this arm is
    // reachable rather than defensive.
    if (input.facts.subjectKind !== 'order') {
      return {
        ...step,
        status: 'nothing-to-do',
        detail: `Nothing to relay: this automation fired about a ${input.facts.subjectKind}, and the marketplace relay is keyed on an order.`,
      };
    }

    const relay = this.delegates.resolve<IOrderLifecycleRelayService>({
      barrel: '@openlinker/core/orders',
      tokenName: 'ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN',
    });
    if (!relay) {
      return {
        ...step,
        status: 'failed',
        detail:
          'The marketplace relay is not available in this process, so nothing was told to the marketplace.',
      };
    }

    try {
      const result = await relay.relay({
        internalOrderId: input.facts.subjectId,
        originConnectionId: AUTOMATION_RELAY_ORIGIN,
        event: { type: 'dispatched' },
      });

      const applied = result.targets.filter((target) => target.outcome === 'applied');
      if (applied.length > 0) {
        return {
          ...step,
          status: 'done',
          detail: `Told ${applied.length} channel(s) the order shipped.`,
        };
      }

      // Every target refused or could not receive it. Not a failure of THIS
      // step — the relay ran and the destinations had nothing to accept — but
      // the per-target detail is what an operator needs to act, so it is carried
      // rather than collapsed into a count.
      const detail = result.targets
        .map((target) => `${target.connectionId}: ${target.outcome}${target.detail ? ` (${target.detail})` : ''}`)
        .join('; ');
      return {
        ...step,
        status: 'nothing-to-do',
        detail:
          result.targets.length === 0
            ? 'No channel could be told: this order has no participant that accepts status updates.'
            : `No channel accepted the update. ${detail}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Automation "${input.rule.name}" (${input.rule.id}) relay failed for order ` +
          `${input.facts.subjectId}: ${message}`,
      );
      return { ...step, status: 'failed', detail: `Telling the marketplace failed: ${message}` };
    }
  }
}
