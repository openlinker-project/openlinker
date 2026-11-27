/**
 * Sales Document Setting Repository (#3941)
 *
 * TypeORM implementation over the singleton `sales_document_settings` row,
 * upserted with one `ON CONFLICT (id)` statement.
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 * @implements {SalesDocumentSettingRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  SalesDocumentSettingRecord,
  SalesDocumentSettingRepositoryPort,
} from '../../../domain/ports/sales-document-setting-repository.port';
import { SalesDocumentSettingOrmEntity } from '../entities/sales-document-setting.orm-entity';

const SINGLETON_ID = 'singleton';

@Injectable()
export class SalesDocumentSettingRepository implements SalesDocumentSettingRepositoryPort {
  constructor(
    @InjectRepository(SalesDocumentSettingOrmEntity)
    private readonly ormRepository: Repository<SalesDocumentSettingOrmEntity>,
  ) {}

  async findSetting(): Promise<SalesDocumentSettingRecord | null> {
    const row = await this.ormRepository.findOne({ where: { id: SINGLETON_ID } });
    return row ? this.toRecord(row) : null;
  }

  async upsertGiftDocumentForm(
    form: string | null,
    unitPrice: string | null,
    updatedBy: string | null,
  ): Promise<SalesDocumentSettingRecord> {
    await this.ormRepository.upsert(
      { id: SINGLETON_ID, giftDocumentForm: form, giftDocumentUnitPrice: unitPrice, updatedBy },
      { conflictPaths: ['id'] },
    );
    const saved = await this.ormRepository.findOneOrFail({ where: { id: SINGLETON_ID } });
    return this.toRecord(saved);
  }

  private toRecord(entity: SalesDocumentSettingOrmEntity): SalesDocumentSettingRecord {
    return {
      giftDocumentForm: entity.giftDocumentForm,
      giftDocumentUnitPrice: entity.giftDocumentUnitPrice,
      updatedAt: entity.updatedAt,
      updatedBy: entity.updatedBy,
    };
  }
}
