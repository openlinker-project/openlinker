/**
 * Promotion Service (#3935)
 *
 * Application service over promotion definitions and their ledger view. It
 * narrows untrusted input on the way in (a malformed condition or benefit is an
 * error there is an operator to tell), computes the definition hash, and guards
 * against an identical definition on an overlapping window. Ordering, counting
 * and pausing are decisions the planner and the ingestion path make.
 *
 * @module libs/core/src/promotions/application/services
 * @implements {IPromotionService}
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  PROMOTION_LEDGER_TOKEN,
  PROMOTION_REPOSITORY_TOKEN,
} from '../../promotions.tokens';
import { Promotion } from '../../domain/entities/promotion.entity';
import {
  PromotionConflictError,
  PromotionInvalidError,
  PromotionNotFoundError,
  PromotionReorderMismatchError,
} from '../../domain/exceptions/promotion.errors';
import { PromotionLedgerPort } from '../../domain/ports/promotion-ledger.port';
import {
  PromotionRepositoryPort} from '../../domain/ports/promotion-repository.port';
import type {
  PromotionPersistInput
} from '../../domain/ports/promotion-repository.port';
import type { PromotionState } from '../../domain/types/promotion-application.types';
import { isPromotionBenefit } from '../../domain/types/promotion-benefit.types';
import { isPromotionCondition, type PromotionCondition } from '../../domain/types/promotion-condition.types';
import { computePromotionDefinitionHash } from '../../domain/types/promotion-definition-hash.types';
import type { PromotionLimits } from '../../domain/types/promotion-limits.types';
import {
  PROMOTION_DRAFT_ID,
  type IPromotionService,
  type PromotionInput,
  type PromotionView,
} from '../interfaces/promotion.service.interface';

const OPEN_ENDED = new Date(8640000000000000);
const MAX_NAME_LENGTH = 200;
const MAX_CONDITIONS = 20;

function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo ?? OPEN_ENDED;
  const bEnd = bTo ?? OPEN_ENDED;
  return aFrom.getTime() <= bEnd.getTime() && bFrom.getTime() <= aEnd.getTime();
}

function positiveIntOrNull(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

@Injectable()
export class PromotionService implements IPromotionService {
  constructor(
    @Inject(PROMOTION_REPOSITORY_TOKEN) private readonly promotions: PromotionRepositoryPort,
    @Inject(PROMOTION_LEDGER_TOKEN) private readonly ledger: PromotionLedgerPort,
  ) {}

  async list(): Promise<PromotionView[]> {
    const promotions = await this.promotions.findAllOrdered();
    const ids = promotions.map((p) => p.id);
    const [states, given] = await Promise.all([
      this.ledger.findStates(ids),
      this.ledger.sumUnitsGiven(ids),
    ]);
    return promotions.map((p) => this.toView(p, states.get(p.id) ?? null, given.get(p.id) ?? 0));
  }

  async get(id: string): Promise<PromotionView> {
    const view = (await this.list()).find((v) => v.promotion.id === id);
    if (view === undefined) throw new PromotionNotFoundError(id);
    return view;
  }

  async create(input: PromotionInput): Promise<PromotionView> {
    const persist = this.validateAndHash(input);
    await this.assertNoConflict(persist, null);
    const created = await this.promotions.create(persist);
    return this.get(created.id);
  }

  async update(id: string, input: PromotionInput): Promise<PromotionView> {
    const existing = await this.promotions.findById(id);
    if (existing === null) throw new PromotionNotFoundError(id);
    const persist = this.validateAndHash(input);
    await this.assertNoConflict(persist, id);
    await this.promotions.update(id, persist);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.promotions.findById(id);
    if (existing === null) throw new PromotionNotFoundError(id);
    await this.promotions.delete(id);
  }

  async reorder(orderedIds: readonly string[]): Promise<PromotionView[]> {
    const current = await this.promotions.findAllOrdered();
    const known = new Set(current.map((p) => p.id));
    const requested = new Set(orderedIds);
    // Exhaustive on purpose: a partial list would leave the unnamed promotions at
    // stale positions while looking like it worked.
    if (
      requested.size !== orderedIds.length ||
      requested.size !== known.size ||
      orderedIds.some((id) => !known.has(id))
    ) {
      throw new PromotionReorderMismatchError(
        [...known].filter((id) => !requested.has(id)),
        orderedIds.filter((id) => !known.has(id)),
      );
    }
    await this.promotions.setPositions(orderedIds);
    return this.list();
  }

  async resumeAfterCap(id: string, additionalUnits: number): Promise<PromotionView> {
    const existing = await this.promotions.findById(id);
    if (existing === null) throw new PromotionNotFoundError(id);
    await this.ledger.extendCap(id, Math.max(1, Math.floor(additionalUnits)));
    return this.get(id);
  }

  buildDraft(input: PromotionInput): Promotion {
    const persist = this.validateAndHash(input);
    const now = new Date();
    return new Promotion(
      PROMOTION_DRAFT_ID,
      persist.name,
      true,
      Number.MAX_SAFE_INTEGER,
      persist.effectiveFrom,
      persist.effectiveTo,
      persist.conditions,
      persist.benefit,
      persist.combinable,
      persist.limits,
      persist.definitionHash,
      now,
      now,
    );
  }

  private toView(promotion: Promotion, state: PromotionState | null, unitsGiven: number): PromotionView {
    const cap = promotion.limits.unitCap;
    return {
      promotion,
      state,
      unitsGiven,
      effectiveCap: cap === null ? null : cap + (state?.capExtension ?? 0),
    };
  }

  /** Narrow every untrusted member, then hash the NARROWED values. */
  private validateAndHash(input: PromotionInput): PromotionPersistInput {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw new PromotionInvalidError('name', null, `must be 1-${MAX_NAME_LENGTH} characters`);
    }
    if (input.conditions.length > MAX_CONDITIONS) {
      throw new PromotionInvalidError('condition', null, `at most ${MAX_CONDITIONS} conditions`);
    }
    const conditions: PromotionCondition[] = [];
    input.conditions.forEach((condition, index) => {
      if (!isPromotionCondition(condition)) {
        throw new PromotionInvalidError('condition', index, 'malformed');
      }
      conditions.push(condition);
    });
    if (!isPromotionBenefit(input.benefit)) {
      throw new PromotionInvalidError('benefit', null, 'malformed or of an unknown kind');
    }
    const unitCap = positiveIntOrNull(input.limits?.unitCap);
    const customerLimit = positiveIntOrNull(input.limits?.customerLimit);
    if (unitCap === undefined || customerLimit === undefined) {
      throw new PromotionInvalidError('limits', null, 'limits must be positive integers or null');
    }
    if (input.effectiveTo !== null && input.effectiveTo.getTime() < input.effectiveFrom.getTime()) {
      throw new PromotionInvalidError('window', null, 'the end precedes the start');
    }
    const limits: PromotionLimits = { unitCap, customerLimit };
    const combinable = input.combinable ?? true;
    return {
      name,
      // Fails closed: a promotion is switched on deliberately.
      isActive: input.isActive ?? false,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      conditions,
      benefit: input.benefit,
      combinable,
      limits,
      definitionHash: computePromotionDefinitionHash({
        conditions,
        benefit: input.benefit,
        combinable,
        limits,
      }),
    };
  }

  private async assertNoConflict(
    input: PromotionPersistInput,
    excludeId: string | null,
  ): Promise<void> {
    const candidates = await this.promotions.findByDefinitionHash(input.definitionHash);
    for (const candidate of candidates) {
      if (candidate.id === excludeId) continue;
      if (
        rangesOverlap(
          input.effectiveFrom,
          input.effectiveTo,
          candidate.effectiveFrom,
          candidate.effectiveTo,
        )
      ) {
        throw new PromotionConflictError(input.definitionHash, candidate.id);
      }
    }
  }
}
