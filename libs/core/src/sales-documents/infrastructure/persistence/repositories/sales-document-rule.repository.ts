/**
 * Sales-Document Rule Repository (#2170)
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SalesDocumentRuleRepositoryPort } from '../../../domain/ports/sales-document-rule-repository.port';
import { SalesDocumentRule } from '../../../domain/entities/sales-document-rule.entity';
import type { SalesDocumentRuleInput } from '../../../domain/types/sales-document-rule-write.types';
import { isSalesDocumentCondition } from '../../../domain/types/sales-document-condition.types';
import { SalesDocumentRuleOrmEntity } from '../entities/sales-document-rule.orm-entity';

@Injectable()
export class SalesDocumentRuleRepository implements SalesDocumentRuleRepositoryPort {
  constructor(
    @InjectRepository(SalesDocumentRuleOrmEntity)
    private readonly ormRepository: Repository<SalesDocumentRuleOrmEntity>,
  ) {}

  async findById(id: string): Promise<SalesDocumentRule | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByCountry(country: string): Promise<SalesDocumentRule[]> {
    const entities = await this.ormRepository.find({ where: { country } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findByCountryAndConditionsHash(
    country: string,
    conditionsHash: string,
  ): Promise<SalesDocumentRule[]> {
    const entities = await this.ormRepository.find({ where: { country, conditionsHash } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async create(input: SalesDocumentRuleInput & { conditionsHash: string }): Promise<SalesDocumentRule> {
    const entity = this.ormRepository.create({
      country: input.country,
      conditions: input.conditions,
      conditionsHash: input.conditionsHash,
      documentKind: input.documentKind,
      connectionId: input.connectionId,
      effectiveFrom: toDateOnly(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? toDateOnly(input.effectiveTo) : null,
      provenance: input.provenance,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.ormRepository.delete({ id });
  }

  async countRulesByCountry(): Promise<Map<string, number>> {
    const rows = await this.ormRepository
      .createQueryBuilder('rule')
      .select('rule.country', 'country')
      .addSelect('COUNT(*)', 'count')
      .groupBy('rule.country')
      .getRawMany<{ country: string; count: string }>();
    return new Map(rows.map((row) => [row.country, Number(row.count)]));
  }

  private toDomain(entity: SalesDocumentRuleOrmEntity): SalesDocumentRule {
    const rawConditions = Array.isArray(entity.conditions) ? entity.conditions : [];
    const conditions = rawConditions.filter(isSalesDocumentCondition);
    return new SalesDocumentRule(
      entity.id,
      entity.country,
      conditions,
      entity.conditionsHash,
      entity.documentKind,
      entity.connectionId,
      new Date(entity.effectiveFrom),
      entity.effectiveTo ? new Date(entity.effectiveTo) : null,
      entity.provenance,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
