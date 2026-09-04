/**
 * Fulfillment Worklist Service (#2406, `W3a-19`, DESIGN §5.2, REVIEW C10)
 *
 * Derives `supportedActions` on the read and enforces the optimistic token on
 * the write. See the interface for the split from `IFulfillmentWorkQueryService`.
 *
 * ## How a stale token is told apart from an illegal action
 *
 * Every action's write is a conditional UPDATE carrying BOTH the state guard and
 * `"version" = :expectedVersion` (`withVersionGuard`). A refusal therefore has
 * two possible causes, and they are different facts:
 *
 * - the version moved  → somebody else acted first → **409 + refreshed actions**
 * - the version matched → the state guard refused   → not legal / already applied
 *
 * The second must NOT be reported as a stale-token 409: `fulfillment-work.types.ts`
 * says of `version` that *"a caller replaying an already-applied action sees
 * 'not applied' against an UNCHANGED version, which must not be reported as a
 * stale-token 409."* Distinguishing them is only possible because the version
 * rides in the same WHERE as the state predicate — a separate claim-then-act
 * bumps unconditionally and collapses both into the false answer.
 *
 * The re-read used to decide has a benign race: a peer writing between the
 * failed UPDATE and the re-read makes a state refusal look like a version
 * conflict. That is the safe direction (the client re-reads and retries) and it
 * can never turn a conflict into a success.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentWorklistService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';

import { FulfillmentWorkActionNotLegalError } from '../../domain/exceptions/fulfillment-work-action-not-legal.error';
import { MissingFulfillmentWorkActionFieldError } from '../../domain/exceptions/missing-fulfillment-work-action-field.error';
import { FulfillmentWorkNotFoundError } from '../../domain/exceptions/fulfillment-work-not-found.error';
import { FulfillmentWorkVersionConflictError } from '../../domain/exceptions/fulfillment-work-version-conflict.error';
import { FulfillmentWorkVersionMismatchError } from '../../domain/exceptions/fulfillment-work-version-mismatch.error';
import { UnsupportedFulfillmentWorkActionError } from '../../domain/exceptions/unsupported-fulfillment-work-action.error';
import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentHold } from '../../domain/types/fulfillment-hold.types';
import { deriveSupportedActions } from '../../domain/types/fulfillment-supported-actions.types';
import type { FulfillmentWorkAction } from '../../domain/types/fulfillment-work-action.types';
import type { FulfillmentWork } from '../../domain/types/fulfillment-work.types';
import {
  clampWorklistLimit,
  clampWorklistOffset,
  type FulfillmentWorkListFilter,
} from '../../domain/types/fulfillment-worklist-page.types';
import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import type { IFulfillmentWorklistService } from '../interfaces/fulfillment-worklist.service.interface';
import {
  isOperatorInvocableAction,
  OPERATOR_INVOCABLE_ACTIONS,
  type ApplyFulfillmentWorkActionInput,
  type FulfillmentWorkPageView,
  type FulfillmentWorkView,
  type OperatorInvocableAction,
} from '../types/fulfillment-work-view.types';

/**
 * The actor recorded when an action arrives without a user.
 *
 * `CHK_fulfillment_holds_actor` demands EXACTLY one actor, so "nobody" is not a
 * storable answer; naming the service is both storable and true.
 */
const FULFILLMENT_WORKLIST_ACTOR_SERVICE = 'fulfillment-worklist';

@Injectable()
export class FulfillmentWorklistService implements IFulfillmentWorklistService {
  private readonly logger = new Logger(FulfillmentWorklistService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly works: FulfillmentWorkRepositoryPort
  ) {}

  async list(filter: FulfillmentWorkListFilter): Promise<FulfillmentWorkPageView> {
    const page = await this.works.listWorks(filter);

    // Batched ONCE for the whole page, before any per-work work — never inside
    // a loop, which at limit=100 would be 100 queries (#2083's precedent).
    const holdsByWork = await this.works.listActiveHoldsForWorks(
      page.works.map((work) => work.id)
    );

    return {
      works: page.works.map((work) => this.toView(work, holdsByWork.get(work.id) ?? [])),
      total: page.total,
      limit: clampWorklistLimit(filter.limit),
      offset: clampWorklistOffset(filter.offset),
    };
  }

  async get(workId: string): Promise<FulfillmentWorkView> {
    const work = await this.works.findById(workId);
    if (work === null) throw new FulfillmentWorkNotFoundError(workId);
    return this.toView(work, await this.works.listActiveHolds(workId));
  }

  async listSiblingWorkIds(orderIds: readonly string[]): Promise<Map<string, string[]>> {
    // A straight delegation, and it stays one: the count is deliberately not
    // filtered by anything, because filtering is what makes it wrong.
    return await this.works.listWorkIdsByOrderIds(orderIds);
  }

  async applyAction(input: ApplyFulfillmentWorkActionInput): Promise<FulfillmentWorkView> {
    // Refused before anything is read: an action this surface does not execute
    // is a client error, not a state question.
    if (!isOperatorInvocableAction(input.action)) {
      throw new UnsupportedFulfillmentWorkActionError(String(input.action), [
        ...OPERATOR_INVOCABLE_ACTIONS,
      ]);
    }

    const before = await this.works.findById(input.workId);
    if (before === null) throw new FulfillmentWorkNotFoundError(input.workId);

    try {
      const applied = await this.dispatch(input, input.action);
      if (!applied) await this.explainRefusal(input);
    } catch (error) {
      // The hold paths return a hold rather than a boolean, so they report a
      // refused precondition by throwing the bare persistence-level fact. It is
      // enriched here, where the derivation lives.
      if (error instanceof FulfillmentWorkVersionMismatchError) {
        throw new FulfillmentWorkVersionConflictError(
          error.workId,
          error.expectedVersion,
          error.currentVersion,
          await this.refreshedActions(error.workId)
        );
      }
      throw error;
    }

    this.logger.log(
      `Applied '${input.action}' to fulfillment work ${input.workId} ` +
        `at version ${String(input.expectedVersion)}`
    );
    return this.get(input.workId);
  }

  /**
   * Route the action to its write. Every branch passes `expectedVersion`, so no
   * action can be added here without a token — the reason this is one method
   * rather than a handler per action.
   */
  private async dispatch(
    input: ApplyFulfillmentWorkActionInput,
    action: OperatorInvocableAction
  ): Promise<boolean> {
    const { workId, expectedVersion } = input;

    switch (action) {
      case 'schedule':
        return await this.works.transitionStatus({
          workId,
          from: ['open', 'on_hold'],
          to: 'scheduled',
          expectedVersion,
        });

      case 'mark_in_progress':
        return await this.works.transitionStatus({
          workId,
          from: ['open', 'scheduled', 'on_hold'],
          to: 'in_progress',
          expectedVersion,
        });

      case 'close':
        return await this.works.transitionStatus({
          workId,
          from: ['in_progress'],
          to: 'closed',
          expectedVersion,
        });

      case 'force_cancel':
        // ADR-054 requires a force-close to land on `cancelled` with a reason,
        // never `closed`-as-completed. `operator_forced` is that reason when the
        // caller names none.
        return await this.works.cancel({
          workId,
          reason: input.cancellationReason ?? 'operator_forced',
          cancelledAt: new Date(),
          expectedVersion,
        });

      case 'hold': {
        // NOT `UnsupportedFulfillmentWorkActionError` — `hold` IS invocable, and
        // that error's message would list it as such while denying it.
        if (input.holdReason === undefined) {
          throw new MissingFulfillmentWorkActionFieldError('hold', 'holdReason');
        }
        // `CHK_fulfillment_holds_actor` is an XOR, not an at-least-one: a row
        // with BOTH actors null is rejected by the database. An operator action
        // usually carries a user, but this service is also reachable from a
        // caller that has none (a worker, a future MCP tool), and passing a bare
        // null there turned a legitimate hold into a 500 on a check constraint.
        // So the service names ITSELF as the actor in exactly that case — which
        // is the true answer, and keeps the audit question answerable.
        const actorUserId = input.actorUserId ?? null;
        await this.works.placeHold({
          workId,
          reason: input.holdReason,
          note: input.note ?? null,
          placedByUserId: actorUserId,
          placedByService: actorUserId === null ? FULFILLMENT_WORKLIST_ACTOR_SERVICE : null,
          placedAt: new Date(),
          expectedVersion,
        });
        return true;
      }

      case 'expedite':
      case 'release_expedite': {
        // Both directions are ONE conditional UPDATE with the state guard
        // (`"expeditedAt" IS NULL` / `IS NOT NULL`) and the version guard in the
        // same statement, so a replay of an already-applied expedite is told
        // apart from a stale token exactly as every other transition is.
        //
        // `expeditedAt` is the instant the operator pushed it, so it is OL's
        // own clock: this is an act performed inside OpenLinker, not a fact
        // reported by another system.
        return await this.works.setExpedited({
          workId,
          expeditedAt: action === 'expedite' ? new Date() : null,
          expectedVersion,
        });
      }

      case 'release_hold': {
        if (input.holdId === undefined) {
          throw new MissingFulfillmentWorkActionFieldError('release_hold', 'holdId');
        }
        await this.works.releaseHold({
          holdId: input.holdId,
          workId,
          releasedAt: new Date(),
          releasedByUserId: input.actorUserId ?? null,
          releaseNote: input.releaseNote ?? null,
          expectedVersion,
        });
        return true;
      }
    }
  }

  /**
   * A conditional UPDATE affected no row. Say WHICH of the two guards refused.
   *
   * Always throws.
   */
  private async explainRefusal(input: ApplyFulfillmentWorkActionInput): Promise<never> {
    const now = await this.works.findById(input.workId);
    if (now === null) throw new FulfillmentWorkNotFoundError(input.workId);

    const actions = this.exposedActions(now, await this.works.listActiveHolds(input.workId));

    if (now.version !== input.expectedVersion) {
      throw new FulfillmentWorkVersionConflictError(
        input.workId,
        input.expectedVersion,
        now.version,
        actions
      );
    }
    throw new FulfillmentWorkActionNotLegalError(input.workId, input.action, actions);
  }

  private async refreshedActions(workId: string): Promise<readonly FulfillmentWorkAction[]> {
    const work = await this.works.findById(workId);
    if (work === null) return [];
    return this.exposedActions(work, await this.works.listActiveHolds(workId));
  }

  /**
   * Derive, then narrow to what this surface will execute.
   *
   * The filter is the reason an operator is never offered a control that would
   * 400 — see `OPERATOR_INVOCABLE_ACTIONS` for why the gap exists and when it
   * closes.
   */
  private exposedActions(
    work: FulfillmentWork,
    activeHolds: readonly FulfillmentHold[]
  ): readonly FulfillmentWorkAction[] {
    const invocable = OPERATOR_INVOCABLE_ACTIONS as readonly FulfillmentWorkAction[];
    return deriveSupportedActions({
      status: work.status,
      requestStatus: work.requestStatus,
      activeHoldCount: activeHolds.length,
      assignedConnectionId: work.assignedConnectionId,
      isExpedited: work.expeditedAt !== null,
    }).filter((action) => invocable.includes(action));
  }

  private toView(
    work: FulfillmentWork,
    activeHolds: readonly FulfillmentHold[]
  ): FulfillmentWorkView {
    // Field-by-field, never a spread: this reaches a browser, and an allowlist
    // is what stops a field added to `FulfillmentWork` later from leaking.
    return {
      id: work.id,
      orderId: work.orderId,
      locationId: work.locationId,
      deliveryMethod: work.deliveryMethod,
      assignedConnectionId: work.assignedConnectionId,
      status: work.status,
      requestStatus: work.requestStatus,
      assignmentAttempt: work.assignmentAttempt,
      cancellationReason: work.cancellationReason,
      externalWorkId: work.externalWorkId,
      acceptedAt: work.acceptedAt,
      cancelledAt: work.cancelledAt,
      expeditedAt: work.expeditedAt,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
      lines: work.lines.map((line) => ({
        id: line.id,
        orderLineId: line.orderLineId,
        productVariantId: line.productVariantId,
        totalQuantity: line.totalQuantity,
        fulfilledQuantity: line.fulfilledQuantity,
        cancelledQuantity: line.cancelledQuantity,
      })),
      activeHolds: activeHolds.map((hold) => ({
        id: hold.id,
        reason: hold.reason,
        note: hold.note,
        placedAt: hold.placedAt,
      })),
      supportedActions: this.exposedActions(work, activeHolds),
      version: work.version,
    };
  }
}
