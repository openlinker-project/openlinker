/**
 * Invoice Record Repository
 *
 * TypeORM implementation of `InvoiceRecordRepositoryPort`. Maps ORM ↔ domain
 * privately; callers receive domain entities only. Converts the Postgres
 * unique-violation on the dedup index into `DuplicateInvoiceRecordException`
 * (never leaks `QueryFailedError`), and throws `InvoiceRecordNotFoundException`
 * on the update path when the row is absent.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/repositories
 * @implements {InvoiceRecordRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { InvoiceRecord } from '../../../domain/entities/invoice-record.entity';
import { DuplicateInvoiceRecordException } from '../../../domain/exceptions/duplicate-invoice-record.exception';
import { InvoiceRecordNotFoundException } from '../../../domain/exceptions/invoice-record-not-found.exception';
import type { InvoiceRecordRepositoryPort } from '../../../domain/ports/invoice-record-repository.port';
import type {
  CreateInvoiceRecordInput,
  InvoiceOutcomePatch,
} from '../../../domain/types/invoicing.types';
import { TerminalRegulatoryStatusValues } from '../../../domain/types/invoicing.types';
import { InvoiceRecordOrmEntity } from '../entities/invoice-record.orm-entity';

@Injectable()
export class InvoiceRecordRepository implements InvoiceRecordRepositoryPort {
  constructor(
    @InjectRepository(InvoiceRecordOrmEntity)
    private readonly repository: Repository<InvoiceRecordOrmEntity>,
  ) {}

  async create(input: CreateInvoiceRecordInput): Promise<InvoiceRecord> {
    const entity = this.buildOrmEntity(input);
    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.message.includes('duplicate key') &&
        input.idempotencyKey !== null
      ) {
        throw new DuplicateInvoiceRecordException(input.connectionId, input.idempotencyKey);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<InvoiceRecord | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByOrderId(orderId: string, connectionId: string): Promise<InvoiceRecord | null> {
    const entity = await this.repository.findOne({ where: { orderId, connectionId } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByIdempotencyKey(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<InvoiceRecord | null> {
    const entity = await this.repository.findOne({ where: { connectionId, idempotencyKey } });
    return entity ? this.toDomain(entity) : null;
  }

  async updateOutcome(id: string, patch: InvoiceOutcomePatch): Promise<InvoiceRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new InvoiceRecordNotFoundException(id);
    }
    Object.assign(entity, patch);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findIssuedNonTerminal(
    connectionId: string,
    opts: { limit: number },
  ): Promise<{ items: InvoiceRecord[]; total: number }> {
    // Selection predicate (single source of truth in `TerminalRegulatoryStatusValues`,
    // mirrored by the `IDX_invoice_records_reconcile` partial index):
    //   status = 'issued' AND regulatoryStatus NOT IN (TerminalRegulatoryStatusValues)
    // Connection-scoped, ordered `updatedAt ASC, id ASC` (oldest-reconciled first),
    // capped at `opts.limit` with NO offset — the non-terminal frontier is a
    // shrinking set walked from offset 0 every run (#1121 plan decision #5).
    const [entities, total] = await this.repository
      .createQueryBuilder('record')
      .where('record.connectionId = :connectionId', { connectionId })
      .andWhere('record.status = :status', { status: 'issued' })
      .andWhere('record.regulatoryStatus NOT IN (:...terminal)', {
        terminal: [...TerminalRegulatoryStatusValues],
      })
      .orderBy('record.updatedAt', 'ASC')
      .addOrderBy('record.id', 'ASC')
      .take(opts.limit)
      .getManyAndCount();

    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  private buildOrmEntity(input: CreateInvoiceRecordInput): InvoiceRecordOrmEntity {
    const entity = new InvoiceRecordOrmEntity();
    entity.connectionId = input.connectionId;
    entity.orderId = input.orderId;
    entity.providerType = input.providerType;
    entity.documentType = input.documentType;
    entity.status = input.status;
    entity.idempotencyKey = input.idempotencyKey;
    entity.providerInvoiceId = input.providerInvoiceId ?? null;
    entity.providerInvoiceNumber = input.providerInvoiceNumber ?? null;
    entity.regulatoryStatus = input.regulatoryStatus ?? 'not-applicable';
    entity.clearanceReference = input.clearanceReference ?? null;
    entity.pdfUrl = input.pdfUrl ?? null;
    entity.issuedAt = input.issuedAt ?? null;
    entity.errorMessage = input.errorMessage ?? null;
    return entity;
  }

  private toDomain(entity: InvoiceRecordOrmEntity): InvoiceRecord {
    return new InvoiceRecord(
      entity.id,
      entity.connectionId,
      entity.orderId,
      entity.providerType,
      entity.documentType,
      entity.status,
      entity.providerInvoiceId,
      entity.providerInvoiceNumber,
      entity.regulatoryStatus,
      entity.clearanceReference,
      entity.idempotencyKey,
      entity.pdfUrl,
      entity.issuedAt,
      entity.errorMessage,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
