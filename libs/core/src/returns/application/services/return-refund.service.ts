/**
 * Return Refund Service (#2371, `W2-34`, ADR-056)
 *
 * The refund trigger, and the observation that settles it. This is the money
 * half of the returns aggregate, beside #2370's custody half.
 *
 * ## Six rules this file exists to hold
 *
 * **1. The attempt is persisted BEFORE the crossing, and the persist IS the
 * block.** `claimRefundAttempt` is a single conditional UPDATE over the return's
 * refundable lines (the `claimAttribution` / `claimWaybillRelay` shape), so two
 * concurrent attempts can never both claim the same line. That, not the lock, is
 * what makes a double refund impossible — a lost or expired lock cannot produce
 * one. ADR-056 R1 requires this ordering be restated rather than inherited by
 * analogy from the invoicing guard (#2047), whose guard is a READ and therefore
 * genuinely depends on its lock.
 *
 * **2. The claimed STATE depends on whether a boundary is actually crossed.**
 * `in_doubt` means *boundary crossed, outcome unobserved*. No shipped adapter
 * implements `RefundExecutor`, so on the only path reachable today nothing is
 * crossed — claiming `in_doubt` there would assert a provider call that never
 * happened. So the executor is resolved FIRST (a side-effect-free read; the
 * claim still strictly precedes `executeRefund`) and the claim targets
 * `in_doubt` only when there is something to be in doubt about.
 *
 * **3. `refunded` is entered only on OBSERVATION, carrying the source's own
 * instant.** OL's clock may never stand in for a channel-reported fact
 * (#2336/#2367). Nothing here lets an operator type `refunded`.
 *
 * **4. Any throw is `in_doubt`; only a terminal `denied` unblocks.** Both
 * directions are unrecoverable here, unlike the restock path where a block is
 * recoverable by attestation — so the classifier refuses to guess. See
 * `refund-outcome.domain-service.ts`.
 *
 * **5. This service writes no `RefundRecord`.** It REPORTS the intent; #2376's
 * controller writes it through the already-wired `IOrderRefundService`. The
 * #2100 report-don't-persist seam, for the identical reason: persisting in place
 * would need an `orders` write token inside `ReturnsModule`.
 *
 * **6. Every non-refunding exit names its cause.** The claim alone cannot tell
 * "no lines" from "already attempted" from "in doubt" — zero rows is all three —
 * so the refusal path (and only the refusal path) runs one classifying read
 * before raising.
 *
 * **An orphan refunds nothing**, asserted through the ONE #2332 seam before
 * anything is written or locked.
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnRefundService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  isRefundExecutor,
  type ExecuteRefundCommand,
  type OrderSourcePort,
  type RefundExecutor,
} from '@openlinker/core/orders';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import {
  classifyRefundFailure,
  classifyRefundOutcome,
  refundConfirmedOutOfBand,
  type RefundOutcome,
} from '../../domain/domain-services/refund-outcome.domain-service';
import type { ReturnRecord } from '../../domain/entities/return-record.entity';
import { ReturnNotFoundError } from '../../domain/exceptions/return-not-found.error';
import {
  ReturnRefundBlockedError,
  type ReturnRefundBlockReason,
} from '../../domain/exceptions/return-refund-blocked.error';
import { ReturnRefundContendedError } from '../../domain/exceptions/return-refund-contended.error';
import { ReturnRefundObservationInvalidError } from '../../domain/exceptions/return-refund-observation-invalid.error';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import { RETURN_REPOSITORY_TOKEN, RETURNS_SERVICE_TOKEN } from '../../returns.tokens';
import {
  RETURN_REFUND_LOCK_TTL_MS,
  returnRefundLockKey,
} from './return-refund-lock';
import type {
  IReturnRefundService,
  RecordRefundObservationInput,
  TriggerRefundInput,
  TriggerRefundResult,
} from './return-refund.service.interface';
import { IReturnsService } from './returns.service.interface';

/** The trigger this service is refused by, through the #2332 seam. */
const REFUND_TRIGGER = 'refund';

@Injectable()
export class ReturnRefundService implements IReturnRefundService {
  private readonly logger = new Logger(ReturnRefundService.name);

  constructor(
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returns: IReturnsService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort
  ) {}

  async triggerRefund(returnId: string, input: TriggerRefundInput): Promise<TriggerRefundResult> {
    const at = new Date();

    // An orphan refunds nothing (#2332), asserted through the ONE seam before
    // anything is written or locked — a refund against a phantom order moves
    // real money and no later log line recovers it.
    const record = await this.returns.assertAttributedForTrigger(returnId, REFUND_TRIGGER);
    const internalOrderId = record.internalOrderId;
    if (internalOrderId === null) {
      // Unreachable past the guard; narrows the type without a non-null assertion.
      throw new ReturnNotFoundError(returnId);
    }

    const token = await this.lock.acquire(returnRefundLockKey(returnId), RETURN_REFUND_LOCK_TTL_MS);
    if (token === null) {
      // Refused before the executor is reached, and retryable — see the error.
      throw new ReturnRefundContendedError(returnId);
    }

    try {
      // RULE 2 — resolve the executor BEFORE the claim, because the claim's
      // target state depends on whether a boundary will actually be crossed.
      // A side-effect-free read; the claim still strictly precedes the call.
      const executor = await this.resolveRefundExecutor(record);

      const claimedLineIds = await this.repository.claimRefundAttempt(
        returnId,
        executor === null ? 'triggered' : 'in_doubt',
        at
      );

      if (claimedLineIds.length === 0) {
        // RULE 6 — the claim cannot say WHICH refusal this is, so name it here.
        throw new ReturnRefundBlockedError(returnId, await this.classifyRefusal(returnId));
      }

      const outcome =
        executor === null
          ? refundConfirmedOutOfBand(at)
          : await this.execute(executor, record, input, claimedLineIds);

      // Only the executor path claimed `in_doubt` and therefore needs settling;
      // the out-of-band path already landed on `triggered` in the claim itself.
      if (executor !== null) {
        await this.repository.settleRefundState(returnId, claimedLineIds, outcome.moneyState, [
          'in_doubt',
        ]);
      }

      this.report(returnId, outcome, claimedLineIds.length);

      return {
        record: await this.requireReturn(returnId),
        moneyState: outcome.moneyState,
        claimedLineIds,
        refundRecordIntent: outcome.movesMoney
          ? {
              returnId,
              internalOrderId,
              amount: input.amount,
              currency: input.currency,
              reason: input.reason,
              note: input.note ?? null,
              executedBy: outcome.executedBy,
              recordedAt: outcome.settledAt ?? at,
              providerRefundId: outcome.providerRefundId,
            }
          : null,
        providerMessage: outcome.providerMessage,
      };
    } finally {
      await this.lock.release(returnRefundLockKey(returnId), token);
    }
  }

  async recordRefundObservation(
    returnId: string,
    input: RecordRefundObservationInput
  ): Promise<ReturnRecord> {
    // RULE 3 — `refunded` is a claim about what the SOURCE did, so it needs the
    // source's instant. Checked BEFORE the lock: a malformed request should be
    // refused without contending with a live trigger.
    if (input.observedState === 'refunded' && !(input.observedAt instanceof Date)) {
      throw new ReturnRefundObservationInvalidError(returnId);
    }

    // **Serialized under the SAME per-return lock as the trigger**, because this
    // is read-then-write across two statements (hydrate, then settle) over rows
    // a concurrent `triggerRefund` may be mid-claim on. `fromStates` bounds the
    // damage but does not remove the race: an observation could otherwise settle
    // a line between that trigger's claim and its own settle, and the trigger's
    // settle would then silently move a line the source had already spoken for.
    // One lock, one writer, for every write to this column.
    const token = await this.lock.acquire(returnRefundLockKey(returnId), RETURN_REFUND_LOCK_TTL_MS);
    if (token === null) {
      throw new ReturnRefundContendedError(returnId);
    }

    try {
      const record = await this.requireReturn(returnId);
      const lineIds = record.lines.map((line) => line.id);

      // Every state in which an attempt STANDS. `refunded` is excluded because a
      // settled refund is not re-openable by a later observation — a replayed
      // webhook must never un-refund a buyer — and the attemptable states are
      // excluded because nothing was attempted, so there is nothing to observe.
      const settled = await this.repository.settleRefundState(
        returnId,
        lineIds,
        input.observedState,
        ['triggered', 'in_doubt']
      );

      if (settled === 0) {
        // RULE 6 applied to this method: the source reported an outcome for a
        // return OL has no attempt standing on. Returning the record silently
        // would report success for a write that changed nothing — the same
        // silent decline the trigger's refusal vocabulary exists to prevent.
        this.logger.warn(
          `Return ${returnId}: the source reported "${input.observedState}" but no line was ` +
            'awaiting an outcome (none is triggered or in doubt) — nothing was changed. ' +
            'Either the refund was never triggered from OpenLinker, or this observation ' +
            'has already been recorded.'
        );
      } else {
        this.logger.log(
          `Return ${returnId}: observed "${input.observedState}" from the source — ` +
            `${settled} line(s) resolved out of ${lineIds.length}` +
            (input.observedState === 'denied'
              ? '; the block is cleared and another attempt is permitted'
              : '')
        );
      }

      return this.requireReturn(returnId);
    } finally {
      await this.lock.release(returnRefundLockKey(returnId), token);
    }
  }

  /**
   * Cross the boundary, and classify whatever comes back through the ONE seam.
   *
   * The idempotency key is deterministic and built here, never by the adapter:
   * a retry of the same logical refund recomputes an identical key, which is the
   * only thing standing between one retry and two refunds. There is no per-line
   * `seq` to borrow (a refund is per-RETURN), so the claimed attempt supplies
   * identity — the claimed line ids are stable for as long as the claim stands,
   * and sorting them makes the key independent of row order.
   */
  private async execute(
    executor: RefundExecutor,
    record: ReturnRecord,
    input: TriggerRefundInput,
    claimedLineIds: readonly string[]
  ): Promise<RefundOutcome> {
    const command: ExecuteRefundCommand = {
      // The SOURCE's own id, or nothing. Substituting the OL internal id would
      // hand an adapter a value that cannot exist on the platform, contradicting
      // this field's own contract; `null` at least says so honestly.
      externalOrderId: record.externalOrderId,
      externalReturnId: record.externalReturnId,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      note: input.note ?? null,
      idempotencyKey: `refund:${record.id}:${[...claimedLineIds].sort().join(',')}`,
    };

    try {
      return classifyRefundOutcome(await executor.executeRefund(command));
    } catch (error) {
      // Catches `unknown`, deliberately — core cannot name a platform exception
      // type, and RULE 4 says every throw is in doubt rather than a denial.
      return classifyRefundFailure(error);
    }
  }

  /**
   * Resolve the source connection's `RefundExecutor`, or `null`.
   *
   * Narrowed off the dispatched `OrderSource` adapter with the guard — never
   * `getCapabilityAdapter(id, 'RefundExecutor')`, which passes the manifest gate
   * and then fails inside `dispatchCapability`. **No adapter implements it
   * today**, so `null` is the shipped answer and the out-of-band path is the
   * shipped behaviour.
   *
   * A resolution failure degrades to `null` rather than throwing: it happens
   * BEFORE any claim or boundary crossing, so the worst case is that an operator
   * records an out-of-band refund they were going to record anyway. Throwing
   * would deny them the only refund path that exists because a credential
   * expired.
   */
  private async resolveRefundExecutor(record: ReturnRecord): Promise<RefundExecutor | null> {
    try {
      const adapter = await this.integrations.getCapabilityAdapter<OrderSourcePort>(
        record.sourceConnectionId,
        'OrderSource'
      );
      return isRefundExecutor(adapter) ? adapter : null;
    } catch (error) {
      this.logger.warn(
        `Could not resolve an OrderSource adapter for return ${record.id} while refunding ` +
          `(${(error as Error).message}) — recording the refund as executed out of band`
      );
      return null;
    }
  }

  /**
   * Name the refusal (RULE 6). Read ONLY after a claim came back empty, so the
   * success path stays a single statement.
   */
  private async classifyRefusal(returnId: string): Promise<ReturnRefundBlockReason> {
    const states = await this.repository.listLineMoneyStates(returnId);
    if (states.length === 0) {
      return 'no-lines';
    }
    if (states.includes('in_doubt')) {
      // The dangerous one, so it wins over the milder reading: money may
      // already have moved and the operator must confirm before trying again.
      return 'outstanding-in-doubt';
    }
    // Either every line already carries a standing/settled state, or they look
    // attemptable and a peer won the race between the claim and this read. Both
    // are `already-attempted` by the time the operator reads it, so this is one
    // branch rather than two that return the same value.
    return 'already-attempted';
  }

  /** Every exit is logged, refunding or not — nothing declines silently. */
  private report(returnId: string, outcome: RefundOutcome, lineCount: number): void {
    if (outcome.moneyState === 'in_doubt') {
      this.logger.error(
        `Return ${returnId}: a refund crossed the source boundary and its outcome was NOT ` +
          `observed (${outcome.providerMessage ?? 'no message'}) — ${lineCount} line(s) left ` +
          'in doubt. This will NOT be retried automatically; confirm at the source.'
      );
      return;
    }
    if (outcome.moneyState === 'denied') {
      this.logger.warn(
        `Return ${returnId}: the source denied the refund ` +
          `(${outcome.providerMessage ?? 'no message'}) — no money moved and another attempt ` +
          'is permitted'
      );
      return;
    }
    this.logger.log(
      `Return ${returnId}: refund ${outcome.moneyState} across ${lineCount} line(s), ` +
        `executed by ${outcome.executedBy}` +
        (outcome.executedBy === 'operator_out_of_band'
          ? ' — OpenLinker recorded it and did not move the money'
          : '')
    );
  }

  private async requireReturn(returnId: string): Promise<ReturnRecord> {
    const found = await this.repository.findById(returnId);
    if (found === null) {
      throw new ReturnNotFoundError(returnId);
    }
    return found;
  }
}
