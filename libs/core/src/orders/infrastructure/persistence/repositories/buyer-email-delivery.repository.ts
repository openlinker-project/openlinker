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
  RecordBuyerEmailDeliveryInput,
} from '../../../domain/ports/buyer-email-delivery-repository.port';
import {
  BuyerEmailSuppressionReasonValues,
  type BuyerEmailSuppressionReason,
} from '../../../domain/domain-services/buyer-email-gate.domain-service';
import { isBuyerEmailOutcome } from '../../../domain/types/buyer-email-delivery.types';
import { BuyerEmailDeliveryOrmEntity } from '../entities/buyer-email-delivery.orm-entity';

@Injectable()
export class BuyerEmailDeliveryRepository implements BuyerEmailDeliveryRepositoryPort {
  constructor(
    @InjectRepository(BuyerEmailDeliveryOrmEntity)
    private readonly ormRepository: Repository<BuyerEmailDeliveryOrmEntity>
  ) {}

  async record(input: RecordBuyerEmailDeliveryInput): Promise<BuyerEmailDelivery> {
    const saved = await this.ormRepository.save(this.ormRepository.create({ ...input }));
    return new BuyerEmailDelivery(
      saved.id,
      input.internalOrderId,
      input.connectionId,
      input.templateKey,
      input.subjectRef,
      input.outcome,
      input.suppressionReason,
      input.recipient,
      saved.createdAt
    );
  }

  async hasSent(
    internalOrderId: string,
    templateKey: BuyerEmailTemplate,
    subjectRef: string
  ): Promise<boolean> {
    const count = await this.ormRepository.count({
      where: { internalOrderId, templateKey, subjectRef, outcome: 'sent' },
    });
    return count > 0;
  }

  async markBounced(deliveryId: string): Promise<boolean> {
    const result = await this.ormRepository.update(
      { id: deliveryId, outcome: 'sent' },
      { outcome: 'bounced' }
    );
    return (result.affected ?? 0) > 0;
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
