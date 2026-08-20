/**
 * Sales-Document Country Default Repository (#2170)
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SalesDocumentCountryDefaultRepositoryPort } from '../../../domain/ports/sales-document-country-default-repository.port';
import { SalesDocumentCountryDefault } from '../../../domain/entities/sales-document-country-default.entity';
import type { SalesDocumentCountryDefaultInput } from '../../../domain/types/sales-document-rule-write.types';
import { SalesDocumentCountryDefaultOrmEntity } from '../entities/sales-document-country-default.orm-entity';

@Injectable()
export class SalesDocumentCountryDefaultRepository
  implements SalesDocumentCountryDefaultRepositoryPort
{
  constructor(
    @InjectRepository(SalesDocumentCountryDefaultOrmEntity)
    private readonly ormRepository: Repository<SalesDocumentCountryDefaultOrmEntity>,
  ) {}

  async findById(id: string): Promise<SalesDocumentCountryDefault | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByCountry(country: string): Promise<SalesDocumentCountryDefault[]> {
    const entities = await this.ormRepository.find({ where: { country } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findAll(): Promise<SalesDocumentCountryDefault[]> {
    const entities = await this.ormRepository.find();
    return entities.map((entity) => this.toDomain(entity));
  }

  async findByCountryAndKind(
    country: string,
    documentKind: string,
  ): Promise<SalesDocumentCountryDefault | null> {
    const entity = await this.ormRepository.findOne({ where: { country, documentKind } });
    return entity ? this.toDomain(entity) : null;
  }

  /**
   * `INSERT ... ON CONFLICT (country, document_kind) DO UPDATE` — one atomic
   * statement, not a `findOne` + `create`/`save` round-trip (review finding
   * 10). The prior TOCTOU shape let two concurrent saves for the same
   * `(country, documentKind)` both observe "not found" and both attempt an
   * insert; the second collided against the unique index and 500'd instead
   * of getting the same clean conflict handling `createRule` has. Mirrors
   * `ReportingCurrencySettingRepository.upsertSetting` — the established
   * shape for this repo's singleton/unique-keyed upsert tables.
   */
  async upsert(input: SalesDocumentCountryDefaultInput): Promise<SalesDocumentCountryDefault> {
    await this.ormRepository.upsert(
      {
        country: input.country,
        documentKind: input.documentKind,
        connectionId: input.connectionId,
      },
      { conflictPaths: ['country', 'documentKind'] },
    );
    const saved = await this.ormRepository.findOneOrFail({
      where: { country: input.country, documentKind: input.documentKind },
    });
    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.ormRepository.delete({ id });
  }

  private toDomain(entity: SalesDocumentCountryDefaultOrmEntity): SalesDocumentCountryDefault {
    return new SalesDocumentCountryDefault(
      entity.id,
      entity.country,
      entity.documentKind,
      entity.connectionId,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
