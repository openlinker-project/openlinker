/**
 * Sales-Document Threshold Repository (#2170)
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { SalesDocumentThresholdRepositoryPort } from '../../../domain/ports/sales-document-threshold-repository.port';
import { SalesDocumentThreshold } from '../../../domain/entities/sales-document-threshold.entity';
import type { SalesDocumentThresholdInput } from '../../../domain/types/sales-document-rule-write.types';
import type { SalesDocumentThresholdComparisonOp } from '../../../domain/types/sales-document-condition.types';
import { SalesDocumentThresholdOrmEntity } from '../entities/sales-document-threshold.orm-entity';

@Injectable()
export class SalesDocumentThresholdRepository implements SalesDocumentThresholdRepositoryPort {
  constructor(
    @InjectRepository(SalesDocumentThresholdOrmEntity)
    private readonly ormRepository: Repository<SalesDocumentThresholdOrmEntity>,
  ) {}

  async findAll(): Promise<SalesDocumentThreshold[]> {
    const entities = await this.ormRepository.find();
    return entities.map((entity) => this.toDomain(entity));
  }

  async findByRef(ref: string): Promise<SalesDocumentThreshold | null> {
    const entity = await this.ormRepository.findOne({ where: { ref } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByRefs(refs: readonly string[]): Promise<SalesDocumentThreshold[]> {
    if (refs.length === 0) return [];
    const entities = await this.ormRepository.find({ where: { ref: In([...refs]) } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async create(input: SalesDocumentThresholdInput): Promise<SalesDocumentThreshold> {
    const entity = this.ormRepository.create({
      ref: input.ref,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      comparisonOp: input.comparisonOp,
      versionEffectiveFrom: toDateOnly(input.versionEffectiveFrom),
      versionEffectiveTo: input.versionEffectiveTo ? toDateOnly(input.versionEffectiveTo) : null,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  private toDomain(entity: SalesDocumentThresholdOrmEntity): SalesDocumentThreshold {
    return new SalesDocumentThreshold(
      entity.ref,
      Number(entity.amount),
      entity.currency,
      entity.comparisonOp as SalesDocumentThresholdComparisonOp,
      new Date(entity.versionEffectiveFrom),
      entity.versionEffectiveTo ? new Date(entity.versionEffectiveTo) : null,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
