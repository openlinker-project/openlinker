/**
 * Promotion Application Service (#3935)
 *
 * The I/O around the pure planner: it loads the promotions and the ledger, reads
 * supply through the caller's reader, plans, and writes the grants, state changes
 * and the application log. It does NOT write order lines - the caller owns the
 * order - and imports nothing from `orders`.
 *
 * ## Idempotency has two keys
 * The caller says which promotions already have their line on the order
 * (`presentPromotionIds`); the grant ledger's `(promotionId, orderId)` row says
 * which were GIVEN. A given-but-lineless promotion (a crash between grant and
 * line) is returned as a `self-heal` line grant rebuilt from the grant, without
 * counting it a second time.
 *
 * @module libs/core/src/promotions/application/services
 * @implements {IPromotionApplicationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import {
  PROMOTION_APPLICATION_LOG_TOKEN,
  PROMOTION_LEDGER_TOKEN,
  PROMOTION_REPOSITORY_TOKEN,
} from '../../promotions.tokens';
import type { Promotion } from '../../domain/entities/promotion.entity';
import { evaluatePromotions } from '../../domain/domain-services/evaluate-promotions';
import { planPromotions, sortPromotions } from '../../domain/domain-services/plan-promotions';
import {
  PromotionApplicationLogPort} from '../../domain/ports/promotion-application-log.port';
import type {
  AppendPromotionApplication
} from '../../domain/ports/promotion-application-log.port';
import { PromotionLedgerPort } from '../../domain/ports/promotion-ledger.port';
import { PromotionRepositoryPort } from '../../domain/ports/promotion-repository.port';
import type {
  PromotionContext,
  PromotionOutcome,
  PromotionStockAnswer,
} from '../../domain/types/promotion-application.types';
import type {
  ApplyPromotionsInput,
  ApplyPromotionsResult,
  IPromotionApplicationService,
  PreviewPromotionsInput,
  PreviewPromotionsResult,
  PromotionLineGrant,
  PromotionStockReader,
} from '../interfaces/promotion-application.service.interface';

/** A grant is "pending" until its order reserves; this only bounds a grant whose order never did. */
const PENDING_GRANT_WINDOW_MS = 15 * 60 * 1000;

/** Variants whose supply the benefit depends on; exhaustive over the benefit kinds. */
function supplyVariantIds(promotions: readonly Promotion[]): string[] {
  return [
    ...new Set(
      promotions.map((p) => {
        switch (p.benefit.kind) {
          case 'free-gift':
            return p.benefit.variantId;
        }
      }),
    ),
  ];
}

@Injectable()
export class PromotionApplicationService implements IPromotionApplicationService {
  private readonly logger = new Logger(PromotionApplicationService.name);

  constructor(
    @Inject(PROMOTION_REPOSITORY_TOKEN) private readonly promotions: PromotionRepositoryPort,
    @Inject(PROMOTION_LEDGER_TOKEN) private readonly ledger: PromotionLedgerPort,
    @Inject(PROMOTION_APPLICATION_LOG_TOKEN) private readonly log: PromotionApplicationLogPort,
  ) {}

  async apply(input: ApplyPromotionsInput): Promise<ApplyPromotionsResult> {
    const orderId = input.facts.orderId;
    const now = new Date();
    const ordered = sortPromotions(await this.promotions.findAllOrdered());
    if (ordered.length === 0) return { outcomes: [], lineGrants: [], promotions: [] };

    const grants = await this.ledger.findGrantsForOrder(orderId);
    const grantByPromotion = new Map(grants.map((g) => [g.promotionId, g] as const));
    const alreadyApplied = new Set(
      ordered
        .filter((p) => input.presentPromotionIds.has(p.id) || grantByPromotion.has(p.id))
        .map((p) => p.id),
    );

    const evaluation = evaluatePromotions({
      promotions: ordered,
      facts: input.facts,
      now,
      // A promotion never reaches back to an order placed before it was saved.
      enforceRetroactivityFloor: true,
    });
    const candidates = ordered.filter(
      (p) => !alreadyApplied.has(p.id) && evaluation.matched.some((m) => m.promotionId === p.id),
    );

    // Read the ledger, plan and write the grants under one lock per candidate: two
    // concurrent ingestions otherwise both read the same unit count and both give.
    const planned = await this.ledger.withPromotionsLocked(
      candidates.map((p) => p.id),
      async () => {
        const contexts = await this.buildContexts(candidates, input.customerId, orderId, input.readStock);
        const outcomes = planPromotions({
          promotions: ordered,
          evaluations: evaluation.evaluations,
          alreadyAppliedPromotionIds: alreadyApplied,
          lines: input.lines,
          ...(input.componentProductIds !== undefined && {
            componentProductIds: input.componentProductIds,
          }),
          contexts,
        });
        const lineGrants: PromotionLineGrant[] = [];
        for (const outcome of outcomes) {
          const promotion = ordered.find((p) => p.id === outcome.promotionId);
          if (promotion === undefined) continue;
          if (outcome.applied && !outcome.alreadyApplied) {
            const benefit = promotion.benefit;
            const documentForm = benefit.documentForm ?? null;
            await this.ledger.recordGrant({
              promotionId: promotion.id,
              internalOrderId: orderId,
              customerId: input.customerId,
              quantity: outcome.quantity,
              productId: benefit.productId,
              variantId: benefit.variantId,
              documentForm,
            });
            lineGrants.push({
              promotion,
              productId: benefit.productId,
              variantId: benefit.variantId,
              documentForm,
              quantity: outcome.quantity,
              origin: 'new',
            });
          } else if (outcome.alreadyApplied) {
            const grant = grantByPromotion.get(promotion.id);
            if (!input.presentPromotionIds.has(promotion.id) && grant !== undefined) {
              // From the GRANT: the promotion may have been edited since.
              lineGrants.push({
                promotion,
                productId: grant.productId,
                variantId: grant.variantId,
                documentForm: grant.documentForm,
                quantity: grant.quantity,
                origin: 'self-heal',
              });
            }
          }
          if (outcome.stateChange !== null) await this.applyStateChange(promotion.id, outcome);
        }
        return { outcomes, lineGrants };
      },
    );

    await this.appendOutcomes(planned.outcomes, orderId, input.isFirstIngestion);
    return { outcomes: planned.outcomes, lineGrants: planned.lineGrants, promotions: ordered };
  }

  async preview(input: PreviewPromotionsInput): Promise<PreviewPromotionsResult> {
    const saved = sortPromotions(await this.promotions.findAllOrdered());
    const draft = input.draft;
    const all =
      draft !== undefined && !saved.some((p) => p.id === draft.id)
        ? sortPromotions([...saved, draft])
        : saved;
    const now = new Date();
    const evaluation = evaluatePromotions({
      promotions: all,
      facts: input.facts,
      now,
      enforceRetroactivityFloor: false,
    });
    const savedIds = new Set(saved.map((p) => p.id));
    const matched = (p: Promotion): boolean => evaluation.matched.some((m) => m.promotionId === p.id);
    const savedCandidates = all.filter((p) => savedIds.has(p.id) && matched(p));
    const contexts = await this.buildContexts(
      savedCandidates,
      input.customerId,
      input.facts.orderId,
      input.readStock,
    );
    // A draft has no ledger rows; it plans against an empty ledger and live stock.
    if (draft !== undefined && !savedIds.has(draft.id) && matched(draft)) {
      const stock = await input.readStock(supplyVariantIds([draft]));
      contexts.set(draft.id, {
        state: null,
        unitsGiven: 0,
        customerUnits: input.customerId === null ? null : 0,
        stock: stock.get(draft.benefit.variantId) ?? { kind: 'unknown' },
      });
    }
    const outcomes = planPromotions({
      promotions: all,
      evaluations: evaluation.evaluations,
      // A preview asks "would this give", so a benefit the order already carries
      // from a real run does not answer it.
      alreadyAppliedPromotionIds: new Set(),
      lines: input.lines,
      ...(input.componentProductIds !== undefined && {
        componentProductIds: input.componentProductIds,
      }),
      contexts,
    });
    return { evaluatedAt: now, evaluations: evaluation.evaluations, outcomes };
  }

  async recordFailure(
    promotions: readonly { id: string; name: string }[],
    internalOrderId: string,
    message: string,
  ): Promise<void> {
    const entries: AppendPromotionApplication[] = promotions.map((p) => ({
      promotionId: p.id,
      promotionName: p.name,
      internalOrderId,
      outcome: 'failed',
      reason: null,
      quantity: 0,
      message,
    }));
    try {
      await this.log.append(entries);
    } catch (error) {
      this.logger.warn(
        `Could not record the failed promotion application for order ${internalOrderId}: ${(error as Error).message}`,
      );
    }
  }

  releaseForOrder(internalOrderId: string): Promise<number> {
    return this.ledger.releaseGrantsForOrder(internalOrderId);
  }

  private async applyStateChange(promotionId: string, outcome: PromotionOutcome): Promise<void> {
    const change = outcome.stateChange;
    if (change === null) return;
    if (change.kind === 'pause') {
      await this.ledger.setPause(promotionId, change.reason);
      return;
    }
    // Only a stock pause clears itself; a unit-cap pause needs the explicit resume.
    const [state] = [...(await this.ledger.findStates([promotionId])).values()];
    if (state?.pausedReason === 'gift-out-of-stock') await this.ledger.setPause(promotionId, null);
  }

  private async buildContexts(
    candidates: readonly Promotion[],
    customerId: string | null,
    orderId: string,
    readStock: PromotionStockReader,
  ): Promise<Map<string, PromotionContext>> {
    const contexts = new Map<string, PromotionContext>();
    if (candidates.length === 0) return contexts;
    const ids = candidates.map((p) => p.id);
    const [states, unitsGiven, customerUnits] = await Promise.all([
      this.ledger.findStates(ids),
      this.ledger.sumUnitsGiven(ids),
      customerId === null
        ? Promise.resolve(new Map<string, number>())
        : this.ledger.sumUnitsForCustomer(ids, customerId),
    ]);
    const stock = await this.readSupply(candidates, orderId, readStock);
    for (const promotion of candidates) {
      contexts.set(promotion.id, {
        state: states.get(promotion.id) ?? null,
        unitsGiven: unitsGiven.get(promotion.id) ?? 0,
        customerUnits: customerId === null ? null : (customerUnits.get(promotion.id) ?? 0),
        stock: stock.get(promotion.benefit.variantId) ?? { kind: 'unknown' },
      });
    }
    return contexts;
  }

  /** Supply per variant; `unknown` (never zero) when the read could not answer. */
  private async readSupply(
    promotions: readonly Promotion[],
    orderId: string,
    readStock: PromotionStockReader,
  ): Promise<Map<string, PromotionStockAnswer>> {
    const variantIds = supplyVariantIds(promotions);
    const answers = new Map<string, PromotionStockAnswer>();
    try {
      const read = await readStock(variantIds);
      // Units another order was granted but has not reserved yet are not in the
      // availability number; without this two simultaneous orders see the last unit.
      const pending = await this.ledger.sumPendingUnitsForVariants(
        variantIds,
        orderId,
        new Date(Date.now() - PENDING_GRANT_WINDOW_MS),
      );
      for (const [variantId, answer] of read) {
        answers.set(
          variantId,
          answer.kind === 'unknown'
            ? answer
            : {
                kind: 'known',
                available: Math.max(0, answer.available - (pending.get(variantId) ?? 0)),
              },
        );
      }
    } catch (error) {
      this.logger.warn(`Promotion supply read failed; treating it as unknown: ${(error as Error).message}`);
    }
    return answers;
  }

  /**
   * "Did not match" is the ordinary case for most promotions on most orders and
   * would drown the log; a matched promotion that could NOT apply, and every
   * benefit actually given, are what an operator needs named.
   */
  private async appendOutcomes(
    outcomes: readonly PromotionOutcome[],
    orderId: string,
    isFirstIngestion: boolean,
  ): Promise<void> {
    const entries: AppendPromotionApplication[] = [];
    for (const outcome of outcomes) {
      const noteworthy =
        (outcome.applied && !outcome.alreadyApplied) ||
        (!outcome.applied && outcome.reason !== 'rule-not-matching' && isFirstIngestion);
      if (!noteworthy) continue;
      entries.push({
        promotionId: outcome.promotionId,
        promotionName: outcome.promotionName,
        internalOrderId: orderId,
        outcome: outcome.applied ? 'applied' : 'skipped',
        reason: outcome.applied ? null : outcome.reason,
        quantity: outcome.quantity,
        message: outcome.applied
          ? `Added ${outcome.quantity} gift unit(s) to the order.`
          : `No gift added: ${outcome.reason ?? 'unknown'}.`,
      });
    }
    if (entries.length === 0) return;
    try {
      await this.log.append(entries);
    } catch (error) {
      this.logger.warn(
        `Could not record the promotion applications for order ${orderId}: ${(error as Error).message}`,
      );
    }
  }
}
