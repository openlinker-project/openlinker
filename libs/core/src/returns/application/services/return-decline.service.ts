/**
 * Return Decline Service (#2333, ADR-060 / ADR-044)
 *
 * The one return WRITE OL performs, in ADR-044's proposed-then-confirmed shape.
 *
 * ## The cycle, and why its order is the whole design
 *
 * 1./2. Load the return and refuse an ORPHAN, in one call to the single
 *    attribution seam `IReturnsService.assertAttributedForTrigger('decline')`
 *    (#2332) — **before any adapter is resolved**, so an unattributed return
 *    costs nothing. ADR-060: an orphan blocks every downstream trigger, and an
 *    ADR-044 proposal has a NOT NULL `internalOrderId`, so there is not even a
 *    row this action could record itself as. The guard is deliberately NOT
 *    re-implemented here: a second orphan rule is how the bucket, the block and
 *    this write start disagreeing about one row.
 * 3. Short-circuit an already-stamped `declinedAt` — idempotent, no adapter call.
 * 4. Resolve the source adapter and narrow it to a `ReturnDecliner`; refuse with
 *    a DISTINCT reason where the source declares no such write.
 * 5. **Persist the proposal BEFORE the adapter call, never after** (acceptance
 *    criterion). If OL crashes between the row and the response, the row is the
 *    evidence that a request may have been made — the opposite order would leave
 *    a marketplace-side decline with no OL record of who asked for it.
 * 6. Call the adapter.
 * 7. Terminalise the proposal from what came back.
 * 8. APPLY — and only where the source reported the decline as a FACT.
 *
 * ## `declinedAt` is stamped only from an observed confirmation
 *
 * There is no fallback to OL's clock anywhere in this file. Where the source
 * accepts the request without reporting an instant, the return stays
 * un-stamped and the outcome is `decline-sent` — the returns product spec is
 * explicit that "a 2xx alone never displays as declined by {source}"
 * (§5.6 / US-3). No shipped adapter reaches that branch (Allegro's success body
 * carries `rejection.createdAt`); the reconciler that would later stamp it from
 * a feed observation is Wave 2's (#2372 / #2377), and `upsertFromSource`
 * deliberately never writes OL-owned timestamps. The gap is named rather than
 * silently filled with a guess.
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnDeclineService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import type { OrderSourcePort, ReturnDecliner } from '@openlinker/core/orders';
import {
  isReturnDecliner,
  ORDER_CHANGE_SERVICE_TOKEN,
  type IOrderChangeService,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import type { ReturnRecord } from '../../domain/entities/return-record.entity';
import { ReturnDeclineUnsupportedError } from '../../domain/exceptions/return-decline-unsupported.error';
import { ReturnDeclineRejectedBySourceError } from '../../domain/exceptions/return-decline-rejected-by-source.error';
import { ReturnNotAttributedError } from '../../domain/exceptions/return-not-attributed.error';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type { ReturnDownstreamTrigger } from '../../domain/types/return-trigger.types';
import { RETURN_REPOSITORY_TOKEN, RETURNS_SERVICE_TOKEN } from '../../returns.tokens';
import { IReturnsService } from './returns.service.interface';
import type {
  DeclineReturnInput,
  DeclineReturnResult,
  IReturnDeclineService,
} from './return-decline.service.interface';

/** The ADR-044 kind this service proposes. */
const RETURN_DECLINE_KIND = 'return.decline';

/** The attribution-guard vocabulary this write is refused by (#2332). */
const RETURN_DECLINE_TRIGGER: ReturnDownstreamTrigger = 'decline';

@Injectable()
export class ReturnDeclineService implements IReturnDeclineService {
  private readonly logger = new Logger(ReturnDeclineService.name);

  constructor(
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returns: IReturnsService,
    @Inject(ORDER_CHANGE_SERVICE_TOKEN)
    private readonly orderChanges: IOrderChangeService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async decline(input: DeclineReturnInput): Promise<DeclineReturnResult> {
    // Steps 1 and 2 in ONE call, through the single attribution seam (#2332).
    // It reads the row, raises `ReturnNotFoundError` for an unknown id and
    // `ReturnNotAttributedError('decline')` for an orphan, and hands back the
    // aggregate — so this service never spells its own `internalOrderId === null`
    // check, and the refusal a Wave-2 trigger catches is the very same class.
    const record = await this.returns.assertAttributedForTrigger(
      input.returnId,
      RETURN_DECLINE_TRIGGER
    );

    // The guard is what makes this non-null. Re-asserted rather than `!`-ed: if a
    // future change to the guard ever let an orphan through, this raises the same
    // refusal instead of writing a NULL into `order_changes.internalOrderId`,
    // which is NOT NULL. Unreachable today, by construction.
    const internalOrderId = record.internalOrderId;
    if (internalOrderId === null) {
      throw new ReturnNotAttributedError(record.id, RETURN_DECLINE_TRIGGER);
    }

    if (record.declinedAt !== null) {
      // Idempotent, and cheap: no adapter is resolved and nothing is sent.
      this.logger.debug(
        `Return ${record.id} is already declined (${record.declinedAt.toISOString()}) — nothing sent`
      );
      const previous = await this.orderChanges.findLatestByTarget(
        internalOrderId,
        record.id,
        RETURN_DECLINE_KIND
      );
      return {
        outcome: 'already-declined',
        changeId: previous?.id ?? null,
        declinedAt: record.declinedAt,
        refusalReason: null,
      };
    }

    const externalReturnId = this.requireExternalReturnId(record);
    const decliner = await this.resolveDecliner(record);

    // THE PROPOSAL, BEFORE THE CALL. Reusing an open proposal is what makes a
    // double-call safe: the partial unique index admits one open row per
    // (order, target), so the second caller never reaches the adapter.
    const { change, opened } = await this.orderChanges.openOrReuse({
      internalOrderId,
      kind: RETURN_DECLINE_KIND,
      targetRef: record.id,
      payload: { reasonCode: input.reasonCode, comment: input.comment },
      requestedBy: input.requestedBy,
      requestedAt: new Date(),
    });

    if (!opened) {
      this.logger.debug(
        `Decline for return ${record.id} is already in flight as change ${change.id} — not sending a second request`
      );
      return {
        outcome: 'in-flight',
        changeId: change.id,
        declinedAt: null,
        refusalReason: null,
      };
    }

    let result;
    try {
      result = await decliner.declineReturn({
        externalReturnId,
        reasonCode: input.reasonCode,
        comment: input.comment,
      });
    } catch (error) {
      if (error instanceof ReturnDeclineRejectedBySourceError) {
        // A deterministic refusal becomes a queryable outcome rather than a
        // swallowed error — ADR-044's headline benefit.
        await this.orderChanges.decline(change.id, error.reason);
        this.logger.warn(
          `Source refused the decline of return ${record.id} (connection ${record.sourceConnectionId}, change ${change.id}): ${error.reason}`
        );
        return {
          outcome: 'refused',
          changeId: change.id,
          declinedAt: null,
          refusalReason: error.reason,
        };
      }

      // Anything else is IN DOUBT: OL does not know whether the source applied
      // the change, so the proposal stays OPEN and its TTL — not this catch —
      // is what eventually releases the target. Recording a refusal here would
      // assert something OL cannot support.
      this.logger.error(
        `Decline of return ${record.id} failed in doubt (connection ${record.sourceConnectionId}, change ${change.id}): ${(error as Error).message}`,
        (error as Error).stack
      );
      throw error;
    }

    const confirmed = await this.orderChanges.confirm(
      change.id,
      `source:${record.sourceConnectionId}`
    );
    if (!confirmed) {
      // Someone terminalised the proposal between the call and now. Both writes
      // below are themselves conditional so nothing is corrupted, but the race
      // is reported rather than dropped: a silently-lost confirmation would make
      // the change row disagree with what the source actually did.
      this.logger.warn(
        `Change ${change.id} was no longer open when the decline of return ${record.id} came back; the source's answer may not be recorded on it`
      );
    }

    if (result.declinedAt === null) {
      // The source accepted but has not reported the decline as a fact. The
      // change is confirmed; `appliedAt` is NOT claimed and `declinedAt` stays
      // NULL, because a 2xx alone must never read as "declined by {source}".
      this.logger.log(
        `Decline of return ${record.id} accepted by connection ${record.sourceConnectionId} (change ${change.id}); awaiting the source's own confirmation`
      );
      return {
        outcome: 'decline-sent',
        changeId: change.id,
        declinedAt: null,
        refusalReason: null,
      };
    }

    if (await this.orderChanges.claimApplied(change.id)) {
      await this.repository.claimDeclinedAt(record.id, result.declinedAt);
    }

    this.logger.log(
      `Return ${record.id} declined at source ${record.sourceConnectionId} at ${result.declinedAt.toISOString()} (change ${change.id})`
    );

    return {
      outcome: 'declined',
      changeId: change.id,
      declinedAt: result.declinedAt,
      refusalReason: null,
    };
  }

  /**
   * A return with no source-native id cannot be named to the source at all.
   *
   * Reported as "unsupported" rather than as a bug: this is exactly the
   * operator-authored return and the synthetic-key source (Erli), neither of
   * which the source can be asked to decline. It is a state, not a failure.
   */
  private requireExternalReturnId(record: ReturnRecord): string {
    const externalReturnId = record.externalReturnId?.trim() ?? '';
    if (externalReturnId.length === 0) {
      throw new ReturnDeclineUnsupportedError(
        record.id,
        record.sourceConnectionId,
        'the return carries no source-native id, so the source cannot be asked about it'
      );
    }
    return externalReturnId;
  }

  /**
   * Resolve the connection's `OrderSource` adapter and narrow it with the guard
   * — never `getCapabilityAdapter(id, 'ReturnDecliner')`, which would pass the
   * manifest gate and then fail inside `dispatchCapability`.
   *
   * Both failure modes raise the SAME distinct exception type but carry
   * different `detail`, because "this platform has no such write" and "this
   * connection could not be resolved" are different things for an operator to
   * fix, while both mean the same thing to a caller: do not retry.
   */
  private async resolveDecliner(
    record: ReturnRecord
  ): Promise<OrderSourcePort & ReturnDecliner> {
    let adapter: OrderSourcePort;
    try {
      adapter = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
        record.sourceConnectionId,
        'OrderSource'
      );
    } catch (error) {
      this.logger.warn(
        `Cannot decline return ${record.id}: no OrderSource adapter for connection ${record.sourceConnectionId} — ${(error as Error).message}`
      );
      throw new ReturnDeclineUnsupportedError(
        record.id,
        record.sourceConnectionId,
        'no OrderSource adapter could be resolved for the connection'
      );
    }

    if (!isReturnDecliner(adapter)) {
      this.logger.warn(
        `Cannot decline return ${record.id}: connection ${record.sourceConnectionId} declares no decline support`
      );
      throw new ReturnDeclineUnsupportedError(
        record.id,
        record.sourceConnectionId,
        'the source declares no decline support'
      );
    }

    return adapter;
  }
}
