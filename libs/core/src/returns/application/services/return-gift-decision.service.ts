/**
 * Return Gift Decision Service (#3943)
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnGiftDecisionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ReturnGiftDecisionInvalidError } from '../../domain/exceptions/return-gift-decision-invalid.error';
import { ReturnNotFoundError } from '../../domain/exceptions/return-not-found.error';
import { ReturnGiftDecisionRepositoryPort } from '../../domain/ports/return-gift-decision-repository.port';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type {
  RecordReturnGiftDecisionInput,
  ReturnGiftDecision,
} from '../../domain/types/return-gift-decision.types';
import {
  RETURN_GIFT_DECISION_REPOSITORY_TOKEN,
  RETURN_REPOSITORY_TOKEN,
  RETURNS_SERVICE_TOKEN,
} from '../../returns.tokens';
import type { IReturnGiftDecisionService } from './return-gift-decision.service.interface';
import { IReturnsService } from './returns.service.interface';

@Injectable()
export class ReturnGiftDecisionService implements IReturnGiftDecisionService {
  constructor(
    @Inject(RETURN_GIFT_DECISION_REPOSITORY_TOKEN)
    private readonly decisions: ReturnGiftDecisionRepositoryPort,
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly returns: ReturnRepositoryPort,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returnsService: IReturnsService
  ) {}

  async list(returnId: string): Promise<ReturnGiftDecision[]> {
    if ((await this.returns.findById(returnId)) === null) {
      throw new ReturnNotFoundError(returnId);
    }
    return this.decisions.findByReturnId(returnId);
  }

  async decide(input: RecordReturnGiftDecisionInput): Promise<ReturnGiftDecision> {
    const amount = input.deductionGross ?? null;
    if (input.decision === 'deduct') {
      if (amount === null || !Number.isFinite(amount) || amount <= 0) {
        throw new ReturnGiftDecisionInvalidError('deduction-required');
      }
    } else if (amount !== null) {
      throw new ReturnGiftDecisionInvalidError('deduction-not-allowed');
    }
    // A decision about a gift needs the order the gift was given on.
    await this.returnsService.assertAttributedForTrigger(input.returnId, 'refund');
    if (!input.validGiftLineIds.includes(input.giftLineId)) {
      throw new ReturnGiftDecisionInvalidError('unknown-gift-line');
    }
    return this.decisions.upsert(input, new Date());
  }
}
