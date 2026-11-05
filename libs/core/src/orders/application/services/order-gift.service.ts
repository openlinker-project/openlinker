/**
 * Order Gift Service (#3938, gifts spec 4.5)
 *
 * Evaluates OpenLinker gift rules INLINE at ingestion, after the operator overlay
 * is applied and before anything reserves, routes or decrements: the gift has to
 * be a line of the order when stock is reserved, which the dispatch seam (it runs
 * after) cannot give. The decision is the pure `planGiftApplication`; this service
 * is the I/O around it - rules, ledger, stock - and the one write, a set of keyed
 * lines into the overlay's `addedLines`.
 *
 * ## Idempotency has two keys and they are checked in this order
 * 1. The overlay key `ol-gift:{ruleId}:{lineId}` already on the order -> the gift
 *    is there; nothing is written and nothing is counted again.
 * 2. The grant ledger's `(ruleId, orderId)` row -> the gift was GIVEN but the line
 *    write did not land (a crash between the two); the line is re-added without
 *    counting the grant a second time.
 * The grant is written BEFORE the line, so a crash leaves "granted, line missing",
 * which self-heals, and never "line present, ungranted", which would let the unit
 * cap under-count.
 *
 * ## Why it is fail-open
 * A gift is an extra. An error reading rules or stock must not cost the buyer's
 * order its ingestion, so every failure is logged and the order continues without
 * the gift; the next re-ingestion retries. An unknown stock number is never read
 * as zero or as plenty - the rule reports `gift-stock-unknown` and adds nothing.
 *
 * ## Known limits
 * - The unit cap is checked then written, not one atomic statement, so two
 *   connections ingesting at the same instant can overshoot it by one batch. The
 *   per-connection ingestion lock covers the common case.
 * - The frozen line expansion (#3607) is taken after this runs on a first
 *   ingestion, so a gift that is itself a bundle expands; a gift added on a LATER
 *   ingestion (a retry) is not covered by a frozen expansion that predates it.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderGiftService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  AUTOMATION_RUN_RECORDER_TOKEN,
  GIFT_RULE_SERVICE_TOKEN,
  evaluateAutomationRules,
  planGiftApplication,
  sortGiftRules,
  ATTRIBUTION_OPENLINKER,
  type AutomationGiftAction,
  type AutomationRule,
  type AutomationSubjectFacts,
  type GiftPlanLine,
  type GiftRuleContext,
  type GiftRuleOutcome,
  type GiftStockAnswer,
  type IAutomationRunRecorderService,
  type IGiftRuleService,
} from '@openlinker/core/automation';
import { AVAILABILITY_SERVICE_TOKEN, type IAvailabilityService } from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';

import { ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';
import { isGiftDocumentForm, type LineGift } from '../../domain/types/incoming-order.types';
import {
  applyOrderEditsToOrder,
  olGiftLineKey,
  type OrderAddedLineEdit,
} from '../../domain/types/order-edits.types';
import type { Order } from '../../domain/types/order.types';
import { buildOrderAutomationFacts } from '../../domain/order-automation-facts-projection';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type {
  ApplyGiftRulesInput,
  ApplyGiftRulesResult,
  GiftPreviewInput,
  GiftPreviewResult,
  IOrderGiftService,
} from './order-gift.service.interface';

/** One gift line per rule per order today, so its `lineId` is a fixed ordinal. */
const GIFT_LINE_ID = '1';

function giftActionOf(rule: AutomationRule): AutomationGiftAction | null {
  const step = rule.actions.find((a) => a.action === 'add-gift');
  return step !== undefined && step.action === 'add-gift' ? step : null;
}

@Injectable()
export class OrderGiftService implements IOrderGiftService {
  private readonly logger = new Logger(OrderGiftService.name);

  constructor(
    @Inject(GIFT_RULE_SERVICE_TOKEN)
    private readonly giftRules: IGiftRuleService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availability: IAvailabilityService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(AUTOMATION_RUN_RECORDER_TOKEN)
    private readonly recorder: IAutomationRunRecorderService,
  ) {}

  async applyGiftRules(input: ApplyGiftRulesInput): Promise<ApplyGiftRulesResult> {
    const { order } = input;
    let rules: AutomationRule[] = [];
    let affected: readonly AutomationRule[] = [];
    const now = new Date();
    try {
      if (order.status === 'cancelled') return { order, outcomes: [] };

      rules = await this.giftRules.listOrderedRules();
      affected = rules;
      if (rules.length === 0) return { order, outcomes: [] };

      const existingKeys = new Set(Object.keys(input.edits?.addedLines ?? {}));
      const grants = await this.giftRules.getGrantsForOrder(order.id);
      const grantByRule = new Map(grants.map((g) => [g.ruleId, g] as const));
      const alreadyAppliedRuleIds = new Set(
        rules
          .filter(
            (rule) =>
              existingKeys.has(olGiftLineKey(rule.id, GIFT_LINE_ID)) || grantByRule.has(rule.id),
          )
          .map((rule) => rule.id),
      );

      const facts = this.factsFromOrder(order, input.sourceConnectionId, input.occurredAt);
      const evaluation = evaluateAutomationRules({
        trigger: 'order.ingested',
        facts,
        rules,
        now,
        // R4: a rule never reaches back to an order placed before it was saved.
        enforceRetroactivityFloor: true,
      });

      const candidates = rules.filter(
        (rule) =>
          !alreadyAppliedRuleIds.has(rule.id) &&
          evaluation.matched.some((m) => m.ruleId === rule.id),
      );
      affected = candidates;

      // Read the ledger, plan and write the grants under one lock per candidate
      // rule: two concurrent ingestions otherwise both read the same unit count
      // and both give, overshooting the cap or the customer limit.
      const planned = await this.giftRules.withRulesLocked(
        candidates.map((rule) => rule.id),
        async () => {
          const contexts = await this.buildContexts(candidates, input.customerId);
          const planOutcomes = planGiftApplication({
            rules,
            evaluations: evaluation.evaluations,
            alreadyAppliedRuleIds,
            lines: this.planLines(order),
            contexts,
          });
          const lines: Record<string, OrderAddedLineEdit> = {};
          for (const outcome of planOutcomes) {
            const rule = rules.find((r) => r.id === outcome.ruleId);
            const action = rule === undefined ? null : giftActionOf(rule);
            if (rule === undefined || action === null) continue;

            if (outcome.applied && !outcome.alreadyApplied) {
              await this.giftRules.recordGrant({
                ruleId: rule.id,
                internalOrderId: order.id,
                customerId: input.customerId,
                quantity: outcome.quantity,
              });
              lines[olGiftLineKey(rule.id, GIFT_LINE_ID)] = this.buildAddedLine(
                rule,
                action,
                outcome.quantity,
                now,
              );
            } else if (outcome.alreadyApplied) {
              // Granted earlier; re-add the line only when it is missing (crash
              // between the grant and the line write), at the granted quantity.
              const key = olGiftLineKey(rule.id, GIFT_LINE_ID);
              const grant = grantByRule.get(rule.id);
              if (!existingKeys.has(key) && grant !== undefined) {
                lines[key] = this.buildAddedLine(rule, action, grant.quantity, now);
              }
            }
            if (outcome.stateChange !== null) {
              await this.giftRules.applyStateChange(rule.id, outcome.stateChange);
            }
          }
          return { outcomes: planOutcomes, newLines: lines };
        },
      );
      const outcomes = planned.outcomes;
      const newLines = planned.newLines;

      let result = order;
      if (Object.keys(newLines).length > 0) {
        const written = await this.orderRecords.applyOrderEdit({
          internalOrderId: order.id,
          expectedRev: null,
          addedLines: newLines,
        });
        if (written !== null) {
          // Re-apply the overlay from the channel original: the gift is now part
          // of every later step (reservation, routing, the destination mirror).
          result = applyOrderEditsToOrder(input.channelOrder, written.orderEdits);
        } else {
          this.logger.warn(
            `Gift lines for order ${order.id} were not written (the record is not ready); the next ingestion retries.`,
          );
        }
      }

      await this.recordRuns(rules, outcomes, facts, now, input.isFirstIngestion);
      return { order: result, outcomes };
    } catch (error) {
      this.logger.error(
        `Gift rules failed for order ${order.id}; the order continues without a gift: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.recordFailure(affected, order, input.sourceConnectionId, now, error as Error);
      return { order, outcomes: [] };
    }
  }

  /**
   * Fail-open must not be silent: an order from a journal-cursor source is not
   * re-delivered, so a retry may never come. Each rule that was in play gets a
   * FAILED run naming it and the order; `automation_runs` failures are what the
   * automation attention state reads, so the operator sees the missing gift.
   */
  private async recordFailure(
    rules: readonly AutomationRule[],
    order: Order,
    sourceConnectionId: string,
    now: Date,
    error: Error,
  ): Promise<void> {
    const message = `Gift not added to order ${order.id}: ${error.message}`;
    for (const rule of rules) {
      try {
        await this.recorder.record({
          rule,
          trigger: 'order.ingested',
          facts: { subjectKind: 'order', subjectId: order.id, sourceConnectionId },
          outcome: 'failed',
          steps: [
            {
              stepIndex: 0,
              action: 'add-gift',
              status: 'failed',
              detail: message,
              report: { attributedTo: ATTRIBUTION_OPENLINKER, message },
            },
          ],
          firedAt: now,
        });
      } catch (recordError) {
        this.logger.warn(
          `Could not record the failed gift run for rule ${rule.id}: ${(recordError as Error).message}`,
        );
      }
    }
  }

  async previewForOrder(input: GiftPreviewInput): Promise<GiftPreviewResult> {
    const { record, draftRule } = input;
    const saved = await this.giftRules.listOrderedRules();
    const rules = sortGiftRules(
      draftRule !== undefined && !saved.some((rule) => rule.id === draftRule.id)
        ? [...saved, draftRule]
        : saved,
    );
    const now = new Date();
    const items = record.orderItems;
    const facts = buildOrderAutomationFacts(record, record.placedAt ?? record.createdAt);
    const evaluation = evaluateAutomationRules({
      trigger: 'order.ingested',
      facts,
      rules,
      now,
      enforceRetroactivityFloor: false,
    });
    const savedIds = new Set(saved.map((rule) => rule.id));
    const candidates = rules.filter(
      (rule) => savedIds.has(rule.id) && evaluation.matched.some((m) => m.ruleId === rule.id),
    );
    const contexts = await this.buildContexts(candidates, record.customerId);
    // A draft has no ledger rows; it plans against an empty ledger and live stock.
    if (draftRule !== undefined && !savedIds.has(draftRule.id)) {
      if (evaluation.matched.some((m) => m.ruleId === draftRule.id)) {
        contexts.set(draftRule.id, await this.draftContext(draftRule, record.customerId));
      }
    }
    const outcomes = planGiftApplication({
      rules,
      evaluations: evaluation.evaluations,
      // A preview asks "would this rule give a gift", so a gift the order already
      // carries from a real run does not answer it.
      alreadyAppliedRuleIds: new Set(),
      lines: items.map<GiftPlanLine>((item) => ({
        productId: item.productId,
        ...(item.variantId !== undefined && { variantId: item.variantId }),
        quantity: item.quantity,
        isGift: item.gift !== undefined,
      })),
      contexts,
    });
    return { evaluatedAt: now, evaluations: evaluation.evaluations, outcomes };
  }

  private factsFromOrder(
    order: Order,
    sourceConnectionId: string,
    occurredAt: Date,
  ): AutomationSubjectFacts {
    const country = order.shippingAddress?.country;
    return {
      subjectKind: 'order',
      subjectId: order.id,
      occurredAt,
      sourceConnectionId,
      ...(country !== undefined && country !== '' && { country }),
      totalGross: order.totals.total,
      currency: order.totals.currency,
      lineProductIds: order.items.filter((i) => i.gift === undefined).map((i) => i.productId),
      lineVariantIds: order.items.flatMap((i) =>
        i.gift === undefined && i.variantId !== undefined ? [i.variantId] : [],
      ),
    };
  }

  private planLines(order: Order): GiftPlanLine[] {
    return order.items.map((item) => ({
      productId: item.productId,
      ...(item.variantId !== undefined && { variantId: item.variantId }),
      quantity: item.quantity,
      isGift: item.gift !== undefined,
    }));
  }

  private async buildContexts(
    candidates: readonly AutomationRule[],
    customerId: string | null,
  ): Promise<Map<string, GiftRuleContext>> {
    const contexts = new Map<string, GiftRuleContext>();
    if (candidates.length === 0) return contexts;
    const ledger = await this.giftRules.getLedgerSnapshot(
      candidates.map((rule) => rule.id),
      customerId,
    );
    const stock = await this.readStock(candidates);
    for (const rule of candidates) {
      contexts.set(rule.id, {
        state: ledger.states.get(rule.id) ?? null,
        unitsGiven: ledger.unitsGiven.get(rule.id) ?? 0,
        customerUnits: customerId === null ? null : (ledger.customerUnits.get(rule.id) ?? 0),
        stock: stock.get(rule.id) ?? { kind: 'unknown' },
      });
    }
    return contexts;
  }

  private async draftContext(rule: AutomationRule, customerId: string | null): Promise<GiftRuleContext> {
    const stock = await this.readStock([rule]);
    return {
      state: null,
      unitsGiven: 0,
      customerUnits: customerId === null ? null : 0,
      stock: stock.get(rule.id) ?? { kind: 'unknown' },
    };
  }

  /** Stock per rule; `unknown` (never zero) when the availability read could not answer. */
  private async readStock(rules: readonly AutomationRule[]): Promise<Map<string, GiftStockAnswer>> {
    const answers = new Map<string, GiftStockAnswer>();
    const variantIds = [
      ...new Set(
        rules.flatMap((rule) => {
          const action = giftActionOf(rule);
          return action === null ? [] : [action.variantId];
        }),
      ),
    ];
    let byVariant = new Map<string, GiftStockAnswer>();
    try {
      const quantities = await this.availability.getPromisableQuantities({
        variantIds,
        scope: { kind: 'global' },
      });
      byVariant = new Map(
        quantities.map((q) => [
          q.productVariantId,
          q.provenance === 'unknown' || q.quantity === null
            ? ({ kind: 'unknown' } as const)
            : ({ kind: 'known', available: q.quantity } as const),
        ]),
      );
    } catch (error) {
      this.logger.warn(`Gift stock read failed; treating it as unknown: ${(error as Error).message}`);
    }
    for (const rule of rules) {
      const action = giftActionOf(rule);
      if (action !== null) answers.set(rule.id, byVariant.get(action.variantId) ?? { kind: 'unknown' });
    }
    return answers;
  }

  private buildAddedLine(
    rule: AutomationRule,
    action: AutomationGiftAction,
    quantity: number,
    at: Date,
  ): OrderAddedLineEdit {
    const gift: LineGift = {
      source: 'ol-rule',
      ruleRef: rule.id,
      ...(isGiftDocumentForm(action.documentForm) && { documentForm: action.documentForm }),
    };
    return {
      changeId: rule.id,
      editedAt: at.toISOString(),
      editedBy: null,
      productId: action.productId,
      variantId: action.variantId,
      quantity,
      name: rule.name,
      gift,
    };
  }

  private async recordRuns(
    rules: readonly AutomationRule[],
    outcomes: readonly GiftRuleOutcome[],
    facts: AutomationSubjectFacts,
    now: Date,
    isFirstIngestion: boolean,
  ): Promise<void> {
    for (const outcome of outcomes) {
      // "Did not match" is the ordinary case for most rules on most orders and
      // would drown the history; a matched rule that could NOT apply, and every
      // gift actually given, are what an operator needs named.
      const noteworthy =
        (outcome.applied && !outcome.alreadyApplied) ||
        (!outcome.applied && outcome.reason !== 'rule-not-matching' && isFirstIngestion);
      if (!noteworthy) continue;
      const rule = rules.find((r) => r.id === outcome.ruleId);
      if (rule === undefined) continue;
      const message = outcome.applied
        ? `Added ${outcome.quantity} gift unit(s) to the order.`
        : `No gift added: ${outcome.reason ?? 'unknown'}.`;
      try {
        await this.recorder.record({
          rule,
          trigger: 'order.ingested',
          facts,
          outcome: outcome.applied ? 'done' : 'nothing-to-do',
          steps: [
            {
              stepIndex: 0,
              action: 'add-gift',
              status: outcome.applied ? 'done' : 'nothing-to-do',
              detail: message,
              report: { attributedTo: ATTRIBUTION_OPENLINKER, message },
            },
          ],
          firedAt: now,
        });
      } catch (error) {
        this.logger.warn(`Could not record the gift run for rule ${rule.id}: ${(error as Error).message}`);
      }
    }
  }
}
