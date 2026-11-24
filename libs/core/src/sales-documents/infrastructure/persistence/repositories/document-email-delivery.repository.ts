/**
 * Document Email Delivery Repository (#3550)
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  DocumentEmailDeliveryRepositoryPort,
  RecordDocumentEmailDeliveryInput,
} from '../../../domain/ports/document-email-delivery-repository.port';
import { DocumentEmailDelivery } from '../../../domain/entities/document-email-delivery.entity';
import {
  DocumentEmailOutcomeValues,
  DocumentEmailSentViaValues,
  isDocumentEmailFailureReason,
  type DocumentEmailOutcome,
  type DocumentEmailSentVia,
} from '../../../domain/types/document-email.types';
import { DocumentEmailDeliveryOrmEntity } from '../entities/document-email-delivery.orm-entity';

@Injectable()
export class DocumentEmailDeliveryRepository implements DocumentEmailDeliveryRepositoryPort {
  constructor(
    @InjectRepository(DocumentEmailDeliveryOrmEntity)
    private readonly ormRepository: Repository<DocumentEmailDeliveryOrmEntity>
  ) {}

  async record(input: RecordDocumentEmailDeliveryInput): Promise<DocumentEmailDelivery> {
    const saved = await this.ormRepository.save(this.ormRepository.create({ ...input }));
    return this.toDomain(saved);
  }

  async listByOrder(internalOrderId: string, limit: number): Promise<DocumentEmailDelivery[]> {
    const rows = await this.ormRepository.find({
      where: { internalOrderId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(entity: DocumentEmailDeliveryOrmEntity): DocumentEmailDelivery {
    return new DocumentEmailDelivery(
      entity.id,
      entity.internalOrderId,
      entity.documentKind,
      entity.documentId,
      (DocumentEmailSentViaValues as readonly string[]).includes(entity.sentVia ?? '')
        ? (entity.sentVia as DocumentEmailSentVia)
        : null,
      // A value this build does not know reads as `failed`, never as `sent`:
      // claiming a delivery that is not recorded would be the worse mistake.
      (DocumentEmailOutcomeValues as readonly string[]).includes(entity.outcome)
        ? (entity.outcome as DocumentEmailOutcome)
        : 'failed',
      isDocumentEmailFailureReason(entity.failureReason) ? entity.failureReason : null,
      entity.recipient,
      entity.actorUserId,
      entity.createdAt
    );
  }
}
