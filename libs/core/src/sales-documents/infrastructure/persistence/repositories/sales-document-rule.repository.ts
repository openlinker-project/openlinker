/**
 * Sales-Document Rule Repository (#2170)
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import type { SalesDocumentRuleRepositoryPort } from '../../../domain/ports/sales-document-rule-repository.port';
import { SalesDocumentRule } from '../../../domain/entities/sales-document-rule.entity';
import type { SalesDocumentRuleInput } from '../../../domain/types/sales-document-rule-write.types';
import { isSalesDocumentCondition } from '../../../domain/types/sales-document-condition.types';
import { SalesDocumentRuleConflictException } from '../../../domain/exceptions/sales-document-rule-conflict.exception';
import { SalesDocumentRuleOrmEntity } from '../entities/sales-document-rule.orm-entity';

const UNIQUE_VIOLATION_CODE = '23505';
const COUNTRY_HASH_FROM_CONSTRAINT = 'UQ_sales_document_rules_country_hash_from';

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

  async findByCountries(countries: readonly string[]): Promise<SalesDocumentRule[]> {
    if (countries.length === 0) {
      return [];
    }
    const entities = await this.ormRepository.find({ where: { country: In([...countries]) } });
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
    try {
      const saved = await this.ormRepository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      // The app-level conflict guard (`assertNoConflict`) deliberately does
      // not flag a same-connection duplicate as a conflict, but the
      // `(country, conditionsHash, effectiveFrom)` unique index doesn't
      // distinguish by connection at all - so an exact same-connection
      // re-save still reaches the DB and must not surface as a raw 500.
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === UNIQUE_VIOLATION_CODE &&
        error.message.includes(COUNTRY_HASH_FROM_CONSTRAINT)
      ) {
        const existing = await this.findByCountryAndConditionsHash(input.country, input.conditionsHash);
        const conflicting = existing.find(
          (rule) => toDateOnly(rule.effectiveFrom) === toDateOnly(input.effectiveFrom),
        );
        throw new SalesDocumentRuleConflictException(
          conflicting?.id ?? 'unknown',
          conflicting?.connectionId ?? input.connectionId,
        );
      }
      throw error;
    }
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
