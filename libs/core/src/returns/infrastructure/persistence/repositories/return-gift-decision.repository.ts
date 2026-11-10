/**
 * Return Gift Decision Repository (#3943)
 *
 * @module libs/core/src/returns/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ReturnGiftDecisionRepositoryPort } from '../../../domain/ports/return-gift-decision-repository.port';
import {
  isReturnGiftDecision,
  type RecordReturnGiftDecisionInput,
  type ReturnGiftDecision,
} from '../../../domain/types/return-gift-decision.types';
import { ReturnGiftDecisionOrmEntity } from '../entities/return-gift-decision.orm-entity';

@Injectable()
export class ReturnGiftDecisionRepository implements ReturnGiftDecisionRepositoryPort {
  constructor(
    @InjectRepository(ReturnGiftDecisionOrmEntity)
    private readonly repository: Repository<ReturnGiftDecisionOrmEntity>
  ) {}

  async findByReturnId(returnId: string): Promise<ReturnGiftDecision[]> {
    const rows = await this.repository.find({ where: { returnId }, order: { decidedAt: 'ASC' } });
    return rows.flatMap((row) => {
      const decision = this.toDomain(row);
      return decision === null ? [] : [decision];
    });
  }

  async upsert(input: RecordReturnGiftDecisionInput, now: Date): Promise<ReturnGiftDecision> {
    const deduction =
      input.decision === 'deduct' && input.deductionGross !== undefined && input.deductionGross !== null
        ? input.deductionGross.toFixed(2)
        : null;
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(ReturnGiftDecisionOrmEntity)
      .values({
        returnId: input.returnId,
        giftLineId: input.giftLineId,
        decision: input.decision,
        deductionGross: deduction,
        note: input.note ?? null,
        decidedByUserId: input.actorUserId,
        decidedAt: now,
      })
      .orUpdate(
        ['decision', 'deductionGross', 'note', 'decidedByUserId', 'decidedAt'],
        ['returnId', 'giftLineId']
      )
      .execute();
    const saved = await this.repository.findOneOrFail({
      where: { returnId: input.returnId, giftLineId: input.giftLineId },
    });
    const decision = this.toDomain(saved);
    if (decision === null) {
      throw new Error(`return_gift_decisions row ${saved.id} holds an unrecognised decision`);
    }
    return decision;
  }

  private toDomain(row: ReturnGiftDecisionOrmEntity): ReturnGiftDecision | null {
    // An unrecognised value reads as absent: a decision this build cannot name
    // must not be reported as one it can.
    if (!isReturnGiftDecision(row.decision)) {
      return null;
    }
    return {
      id: row.id,
      returnId: row.returnId,
      giftLineId: row.giftLineId,
      decision: row.decision,
      deductionGross: row.deductionGross,
      note: row.note,
      decidedByUserId: row.decidedByUserId,
      decidedAt: row.decidedAt,
    };
  }
}
