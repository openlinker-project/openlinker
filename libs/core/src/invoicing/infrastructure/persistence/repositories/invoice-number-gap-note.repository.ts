/**
 * Invoice Number Gap-Note Repository
 *
 * TypeORM implementation of `InvoiceNumberGapNoteRepositoryPort` (#8). Maps
 * ORM ↔ domain privately; callers receive the neutral `NumberingGapNoteData`
 * shape only. `recordNote` upserts on the `(seriesId, seq)` unique key so a gap
 * carries at most one live explanation.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/repositories
 * @implements {InvoiceNumberGapNoteRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { InvoiceNumberGapNoteRepositoryPort } from '../../../domain/ports/invoice-number-gap-note-repository.port';
import type {
  NumberingGapNoteData,
  RecordNumberingGapNoteInput,
} from '../../../domain/types/numbering-audit.types';
import { InvoiceNumberGapNoteOrmEntity } from '../entities/invoice-number-gap-note.orm-entity';

@Injectable()
export class InvoiceNumberGapNoteRepository implements InvoiceNumberGapNoteRepositoryPort {
  constructor(
    @InjectRepository(InvoiceNumberGapNoteOrmEntity)
    private readonly repository: Repository<InvoiceNumberGapNoteOrmEntity>,
  ) {}

  async recordNote(input: RecordNumberingGapNoteInput): Promise<NumberingGapNoteData> {
    const existing = await this.repository.findOne({
      where: { seriesId: input.seriesId, seq: input.seq },
    });
    const entity =
      existing ??
      this.repository.create({ seriesId: input.seriesId, seq: input.seq });
    entity.documentNumber = input.documentNumber ?? null;
    entity.reason = input.reason;
    entity.actorUserId = input.actorUserId ?? null;
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async listBySeriesId(seriesId: string): Promise<NumberingGapNoteData[]> {
    const entities = await this.repository.find({
      where: { seriesId },
      order: { seq: 'ASC' },
    });
    return entities.map((e) => this.toDomain(e));
  }

  private toDomain(entity: InvoiceNumberGapNoteOrmEntity): NumberingGapNoteData {
    return {
      id: entity.id,
      seriesId: entity.seriesId,
      seq: entity.seq,
      documentNumber: entity.documentNumber,
      reason: entity.reason,
      actorUserId: entity.actorUserId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
