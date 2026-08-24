/**
 * Sales-Document Country Acknowledgment Repository (#2186)
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SalesDocumentCountryAcknowledgmentRepositoryPort } from '../../../domain/ports/sales-document-country-acknowledgment-repository.port';
import { SalesDocumentCountryAcknowledgment } from '../../../domain/entities/sales-document-country-acknowledgment.entity';
import { SalesDocumentCountryAcknowledgmentOrmEntity } from '../entities/sales-document-country-acknowledgment.orm-entity';

@Injectable()
export class SalesDocumentCountryAcknowledgmentRepository
  implements SalesDocumentCountryAcknowledgmentRepositoryPort
{
  constructor(
    @InjectRepository(SalesDocumentCountryAcknowledgmentOrmEntity)
    private readonly ormRepository: Repository<SalesDocumentCountryAcknowledgmentOrmEntity>,
  ) {}

  async findAll(): Promise<SalesDocumentCountryAcknowledgment[]> {
    const entities = await this.ormRepository.find();
    return entities.map((entity) => this.toDomain(entity));
  }

  /**
   * `INSERT ... ON CONFLICT (country) DO UPDATE` — one atomic statement, not
   * a `findOne` + `create`/`save` round-trip (same TOCTOU class as review
   * finding 10, applied here too: `country` is this table's primary key, so
   * two concurrent acknowledgments for the same country could otherwise both
   * observe "not found" and race on the insert).
   */
  async upsert(country: string): Promise<SalesDocumentCountryAcknowledgment> {
    await this.ormRepository.upsert(
      { country, acknowledgedAt: new Date() },
      { conflictPaths: ['country'] },
    );
    const saved = await this.ormRepository.findOneOrFail({ where: { country } });
    return this.toDomain(saved);
  }

  async delete(country: string): Promise<void> {
    await this.ormRepository.delete({ country });
  }

  private toDomain(
    entity: SalesDocumentCountryAcknowledgmentOrmEntity,
  ): SalesDocumentCountryAcknowledgment {
    return new SalesDocumentCountryAcknowledgment(entity.country, entity.acknowledgedAt);
  }
}
