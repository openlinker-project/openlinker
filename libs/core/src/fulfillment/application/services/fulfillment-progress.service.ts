/**
 * Fulfillment Progress Service (#2400, ADR-053/054, DESIGN §5.4/§5.5)
 *
 * Records one reported progress fact against a `FulfillmentWork`, at most once,
 * and REPORTS whatever must happen outside this context as an intent.
 *
 * ## The ordering in `record()` is the contract
 *
 * read work -> claim -> mutate -> build intents. Each step earns its position:
 *
 *  1. **Read before claim** so an unknown work id does not burn a claim key. A
 *     burnt key is permanent (the claim table is unconditional by design), so
 *     claiming first would let one misrouted delivery suppress the real event
 *     for that key forever.
 *  2. **Claim before mutate** — the whole point, and REVIEW C9's requirement.
 *     The claim is committed before any counter moves and before any intent is
 *     returned, so a replay cannot re-move counters or re-fire a relay.
 *  3. **Mutate before intents** so an intent is only ever reported for state
 *     that was actually written.
 *
 * `fulfillment-progress-ordering.spec.ts` asserts this directly rather than
 * trusting the prose.
 *
 * ## No sibling-context imports, and that is load-bearing
 *
 * This file imports only its own context and `@nestjs/common`. ADR-053's
 * no-injection invariant is enforced by `scripts/check-no-injection-contracts.mjs`
 * and `barrel-purity.spec.ts`; the reroute that DESIGN §5.5 calls for is
 * reported as an intent precisely because performing it needs `orders`.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentProgressService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

// The two PORTS are value imports, not `import type`, and that is required
// rather than stylistic: both appear as constructor-parameter types under
// `@Inject`, so `emitDecoratorMetadata` reads them at runtime and
// `@typescript-eslint/consistent-type-imports` rejects the type-only form.
// `RecordFulfillmentLineProgressInput` is a pure type and stays type-only.
import { FulfillmentProgressClaimRepositoryPort } from '../../domain/ports/fulfillment-progress-claim-repository.port';
import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import type { RecordFulfillmentLineProgressInput } from '../../domain/ports/fulfillment-work-repository.port';
import type {
  FulfillmentProgressEvent,
  FulfillmentProgressLineDelta,
  FulfillmentProgressOutcome,
  FulfillmentRelayIntent,
} from '../../domain/types/fulfillment-progress-event.types';
import type { FulfillmentWorkStatus } from '../../domain/types/fulfillment-work-status.types';
import {
  FULFILLMENT_PROGRESS_CLAIM_REPOSITORY_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
} from '../../fulfillment.tokens';
import type { IFulfillmentProgressService } from '../interfaces/fulfillment-progress.service.interface';

/**
 * Statuses a work object may move to `in_progress` FROM.
 *
 * `on_hold` is deliberately absent: a hold is an operator's deliberate
 * suspension, and letting an executor's progress report silently lift it would
 * make the hold advisory. A held work reports `precondition-failed`, which is
 * the honest answer.
 */
const IN_PROGRESS_FROM: readonly FulfillmentWorkStatus[] = ['open', 'scheduled', 'in_progress'];

@Injectable()
export class FulfillmentProgressService implements IFulfillmentProgressService {
  private readonly logger = new Logger(FulfillmentProgressService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly workRepository: FulfillmentWorkRepositoryPort,
    @Inject(FULFILLMENT_PROGRESS_CLAIM_REPOSITORY_TOKEN)
    private readonly claimRepository: FulfillmentProgressClaimRepositoryPort
  ) {}

  async record(event: FulfillmentProgressEvent): Promise<FulfillmentProgressOutcome> {
    // (1) Read before claim — never burn a permanent key on an unknown id.
    const work = await this.workRepository.findById(event.workId);
    if (!work) {
      this.logger.warn(
        `Progress event ${event.kind} for unknown work ${event.workId} from connection ${event.connectionId} — not recorded`
      );
      return { status: 'unknown-work', workId: event.workId };
    }

    // (2) Claim before ANY mutation and before ANY intent (REVIEW C9).
    const won = await this.claimRepository.claim({
      workId: event.workId,
      idempotencyKey: event.idempotencyKey,
      connectionId: event.connectionId,
      eventKind: event.kind,
      claimedAt: new Date(),
    });
    if (!won) {
      this.logger.log(
        `Progress event ${event.idempotencyKey} for work ${event.workId} already recorded — no-op`
      );
      return { status: 'duplicate' };
    }

    // (3) Only now write.
    return this.apply(event);
  }

  private async apply(event: FulfillmentProgressEvent): Promise<FulfillmentProgressOutcome> {
    switch (event.kind) {
      case 'picked': {
        const failure = await this.applyLineDeltas(event.workId, event.lines);
        if (failure) {
          return failure;
        }
        // Best-effort: work already `in_progress` is the common case, and a
        // refusal there is not a failure of the pick itself.
        await this.workRepository.transitionStatus({
          workId: event.workId,
          from: IN_PROGRESS_FROM,
          to: 'in_progress',
        });
        return { status: 'recorded', intents: [] };
      }

      case 'short_picked': {
        const failure = await this.applyLineDeltas(event.workId, event.lines);
        if (failure) {
          return failure;
        }
        // DESIGN §5.5 closes the work `incomplete` for the shortfall. Unlike the
        // `picked` transition this one IS load-bearing — the shortfall is only
        // re-sourceable once the work is off the execution path — so a refusal
        // is reported rather than swallowed.
        const closed = await this.workRepository.transitionStatus({
          workId: event.workId,
          from: [...IN_PROGRESS_FROM, 'on_hold'],
          to: 'incomplete',
        });
        if (!closed) {
          return {
            status: 'precondition-failed',
            reason: `work ${event.workId} could not be closed incomplete — it is already terminal`,
          };
        }
        // Reported, never performed: re-entering `route()` needs #2395's router
        // and the routing lock, and the `order.cancelledAt` gate needs
        // `@openlinker/core/orders`. #2401 composes this.
        const intents: FulfillmentRelayIntent[] = [
          { kind: 'reroute', workId: event.workId, blockedHolderId: event.connectionId },
        ];
        return { status: 'recorded', intents };
      }

      case 'packed': {
        // NOTE the deliberate asymmetry with `picked` above, which makes the
        // IDENTICAL call best-effort. It is not an oversight to be reconciled:
        // `picked` has already recorded counters, so a refused transition costs
        // nothing observable, whereas `packed` records nothing else — the
        // transition IS the whole event, so a refusal has to be reported.
        const moved = await this.workRepository.transitionStatus({
          workId: event.workId,
          from: IN_PROGRESS_FROM,
          to: 'in_progress',
        });
        if (!moved) {
          return {
            status: 'precondition-failed',
            reason: `work ${event.workId} is not in a state that can be packed`,
          };
        }
        return { status: 'recorded', intents: [] };
      }

      case 'shipped': {
        // The one event that produces a dispatch relay. The at-most-once gate
        // on the relay itself is `claimDispatchRelay` (#2392, already built);
        // #2401 is its caller.
        return {
          status: 'recorded',
          intents: [{ kind: 'dispatch', workId: event.workId }],
        };
      }

      case 'closed': {
        const moved = await this.workRepository.transitionStatus({
          workId: event.workId,
          from: IN_PROGRESS_FROM,
          to: 'closed',
        });
        if (!moved) {
          return {
            status: 'precondition-failed',
            reason: `work ${event.workId} is not in a state that can be closed`,
          };
        }
        return { status: 'recorded', intents: [] };
      }

      default: {
        // Core-INTERNAL switch, so it keeps the `never`-exhaustive form
        // (ADR-055 G9): a new event kind must break the build here rather than
        // fall silently into a default arm. G9's real `default:` requirement
        // applies at the PORT boundary, where a plugin may send a value this
        // build has never heard of.
        const exhaustive: never = event;
        throw new Error(`Unhandled fulfillment progress event: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /**
   * Move the counters for every reported line, stopping at the first refusal.
   *
   * @returns a `precondition-failed` outcome, or `null` when every line applied.
   */
  private async applyLineDeltas(
    workId: string,
    lines: readonly FulfillmentProgressLineDelta[]
  ): Promise<FulfillmentProgressOutcome | null> {
    for (const line of lines) {
      const input: RecordFulfillmentLineProgressInput = {
        workId,
        orderLineId: line.orderLineId,
        fulfilledDelta: line.fulfilledDelta,
        cancelledDelta: line.cancelledDelta,
      };
      const applied = await this.workRepository.recordLineProgress(input);
      if (!applied) {
        // `false` is the guarded-update convention for "the precondition no
        // longer held and nothing was written" — an ordinary outcome, never an
        // error (see `FulfillmentWorkRepositoryPort`).
        return {
          status: 'precondition-failed',
          reason: `line ${line.orderLineId} on work ${workId} would exceed its total quantity, or does not exist`,
        };
      }
    }
    return null;
  }
}
