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

  async upsert(country: string): Promise<SalesDocumentCountryAcknowledgment> {
    const existing = await this.ormRepository.findOne({ where: { country } });
    const entity = this.ormRepository.create({
      ...(existing ?? {}),
      country,
      acknowledgedAt: new Date(),
    });
    const saved = await this.ormRepository.save(entity);
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
