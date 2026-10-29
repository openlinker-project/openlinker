/**
 * Buyer Email Delivery Repository (#3554)
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isBuyerEmailTemplate, type BuyerEmailTemplate } from '@openlinker/core/identifier-mapping';
import { BuyerEmailDelivery } from '../../../domain/entities/buyer-email-delivery.entity';
import type {
  BuyerEmailDeliveryRepositoryPort,
  ClaimBuyerEmailSendInput,
  RecordBuyerEmailSuppressionInput,
} from '../../../domain/ports/buyer-email-delivery-repository.port';
import {
  BuyerEmailSuppressionReasonValues,
  isBuyerEmailOutcome,
  type BuyerEmailOutcome,
  type BuyerEmailSuppressionReason,
} from '../../../domain/types/buyer-email-delivery.types';
import { BuyerEmailDeliveryOrmEntity } from '../entities/buyer-email-delivery.orm-entity';

@Injectable()
export class BuyerEmailDeliveryRepository implements BuyerEmailDeliveryRepositoryPort {
  constructor(
    @InjectRepository(BuyerEmailDeliveryOrmEntity)
    private readonly ormRepository: Repository<BuyerEmailDeliveryOrmEntity>
  ) {}

  async recordSuppression(input: RecordBuyerEmailSuppressionInput): Promise<BuyerEmailDelivery> {
    const saved = await this.ormRepository.save(
      this.ormRepository.create({ ...input, outcome: 'suppressed' })
    );
    return this.build(saved.id, input, 'suppressed', input.suppressionReason, saved.createdAt);
  }

  /**
   * One statement, so the slot is decided by the index rather than by a read
   * that two concurrent firings could both pass. The conflict target carries the
   * partial index's own predicate, which is what lets Postgres infer it.
   */
  async claimSend(input: ClaimBuyerEmailSendInput): Promise<BuyerEmailDelivery | null> {
    const rows = (await this.ormRepository.query(
      `INSERT INTO "buyer_email_deliveries"
         ("internalOrderId", "connectionId", "templateKey", "subjectRef", "outcome", "recipient")
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT ("internalOrderId", "templateKey", "subjectRef")
         WHERE "outcome" IN ('pending', 'sent')
       DO NOTHING
       RETURNING "id", "createdAt"`,
      [
        input.internalOrderId,
        input.connectionId,
        input.templateKey,
        input.subjectRef,
        input.recipient,
      ]
    )) as Array<{ id: string; createdAt: Date }>;
    const row = rows[0];
    return row ? this.build(row.id, input, 'pending', null, row.createdAt) : null;
  }

  async settleClaim(deliveryId: string, outcome: 'sent' | 'bounced'): Promise<void> {
    await this.ormRepository.update({ id: deliveryId, outcome: 'pending' }, { outcome });
  }

  async releaseClaim(deliveryId: string): Promise<void> {
    await this.ormRepository.delete({ id: deliveryId, outcome: 'pending' });
  }

  async listByOrder(internalOrderId: string, limit: number): Promise<BuyerEmailDelivery[]> {
    const rows = await this.ormRepository.find({
      where: { internalOrderId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.flatMap((row) => {
      const delivery = this.toDomain(row);
      return delivery ? [delivery] : [];
    });
  }

  private build(
    id: string,
    input: {
      internalOrderId: string;
      connectionId: string;
      templateKey: BuyerEmailTemplate;
      subjectRef: string;
      recipient: string | null;
    },
    outcome: BuyerEmailOutcome,
    reason: BuyerEmailSuppressionReason | null,
    createdAt: Date
  ): BuyerEmailDelivery {
    return new BuyerEmailDelivery(
      id,
      input.internalOrderId,
      input.connectionId,
      input.templateKey,
      input.subjectRef,
      outcome,
      reason,
      input.recipient,
      createdAt
    );
  }

  /**
   * A row this build cannot read (unknown template or outcome) is dropped from
   * the read rather than shown as something it may not be. An unknown outcome is
   * never read as `sent`: claiming a delivery that is not recorded is the worse
   * mistake.
   */
  private toDomain(entity: BuyerEmailDeliveryOrmEntity): BuyerEmailDelivery | null {
    if (!isBuyerEmailTemplate(entity.templateKey) || !isBuyerEmailOutcome(entity.outcome)) {
      return null;
    }
    const reason = (BuyerEmailSuppressionReasonValues as readonly string[]).includes(
      entity.suppressionReason ?? ''
    )
      ? (entity.suppressionReason as BuyerEmailSuppressionReason)
      : null;
    return new BuyerEmailDelivery(
      entity.id,
      entity.internalOrderId,
      entity.connectionId,
      entity.templateKey,
      entity.subjectRef,
      entity.outcome,
      reason,
      entity.recipient,
      entity.createdAt
    );
  }
}
