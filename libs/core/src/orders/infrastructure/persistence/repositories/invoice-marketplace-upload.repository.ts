/**
 * Invoice Marketplace Upload Repository
 *
 * TypeORM implementation of `InvoiceMarketplaceUploadRepositoryPort` (#3549).
 * Maps ORM <-> domain privately. Both writers are single guarded statements
 * (`affected`/`RETURNING` is the answer), never a read followed by a write: two
 * concurrent attempts on one `(invoice, target)` must not both believe they won.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 * @implements {InvoiceMarketplaceUploadRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { InvoiceMarketplaceUploadRepositoryPort } from '../../../domain/ports/invoice-marketplace-upload-repository.port';
import {
  CLAIMABLE_UPLOAD_STATUSES,
  UPLOAD_CLAIM_LEASE_MS,
  InvoiceMarketplaceUploadFailureCodeValues,
  InvoiceMarketplaceUploadStatusValues,
  type InvoiceMarketplaceUpload,
  type InvoiceMarketplaceUploadFailureCode,
  type InvoiceMarketplaceUploadStatus,
  type RecordInvoiceMarketplaceUploadOutcome,
} from '../../../domain/types/invoice-marketplace-upload.types';
import { InvoiceMarketplaceUploadOrmEntity } from '../entities/invoice-marketplace-upload.orm-entity';

/** The raw shape `RETURNING *` hands back: column names, not entity properties. */
type UploadRow = {
  id: string;
  invoiceRecordId: string;
  targetConnectionId: string;
  status: string;
  attempts: number;
  lastFailureCode: string | null;
  uploadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class InvoiceMarketplaceUploadRepository implements InvoiceMarketplaceUploadRepositoryPort {
  constructor(
    @InjectRepository(InvoiceMarketplaceUploadOrmEntity)
    private readonly repository: Repository<InvoiceMarketplaceUploadOrmEntity>,
  ) {}

  async findByInvoiceId(invoiceRecordId: string): Promise<InvoiceMarketplaceUpload[]> {
    const entities = await this.repository.find({
      where: { invoiceRecordId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async claimAttempt(
    invoiceRecordId: string,
    targetConnectionId: string,
  ): Promise<InvoiceMarketplaceUpload | null> {
    // INSERT ... ON CONFLICT DO UPDATE ... WHERE: the WHERE is what makes a
    // terminal row (`uploaded`, `unsupported`) and a pending row another attempt
    // still holds answer zero rows instead of being claimed again. A pending row
    // is taken over only once its lease ran out (a crashed attempt). The UPDATE
    // takes the row lock, so two concurrent claims serialise and the second sees
    // the first's fresh `updatedAt`. `gen_random_uuid()` because a raw insert does
    // not go through TypeORM's id generation.
    const rows = (await this.repository.query(
      `INSERT INTO "invoice_marketplace_uploads"
         ("id", "invoiceRecordId", "targetConnectionId", "status", "attempts")
       VALUES (gen_random_uuid(), $1, $2, 'pending', 1)
       ON CONFLICT ("invoiceRecordId", "targetConnectionId") DO UPDATE
         SET "status" = 'pending',
             "attempts" = "invoice_marketplace_uploads"."attempts" + 1,
             "updatedAt" = now()
         WHERE "invoice_marketplace_uploads"."status" = ANY($3)
            OR ("invoice_marketplace_uploads"."status" = 'pending'
                AND "invoice_marketplace_uploads"."updatedAt" < now() - make_interval(secs => $4))
       RETURNING *`,
      [
        invoiceRecordId,
        targetConnectionId,
        [...CLAIMABLE_UPLOAD_STATUSES],
        UPLOAD_CLAIM_LEASE_MS / 1000,
      ],
    )) as UploadRow[];
    return rows.length === 0 ? null : this.rowToDomain(rows[0]);
  }

  async recordOutcome(
    id: string,
    claimedAttempt: number,
    outcome: RecordInvoiceMarketplaceUploadOutcome,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(InvoiceMarketplaceUploadOrmEntity)
      .set({
        status: outcome.status,
        lastFailureCode: outcome.lastFailureCode ?? null,
        uploadedAt: outcome.status === 'uploaded' ? () => 'now()' : null,
      })
      .where('"id" = :id', { id })
      .andWhere('"status" = :pending', { pending: 'pending' })
      // The attempt number is the fencing token: an attempt whose lease ran out
      // and was taken over must not settle the row the newer attempt owns.
      .andWhere('"attempts" = :claimedAttempt', { claimedAttempt })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  private toDomain(entity: InvoiceMarketplaceUploadOrmEntity): InvoiceMarketplaceUpload {
    return this.rowToDomain(entity);
  }

  private rowToDomain(row: UploadRow): InvoiceMarketplaceUpload {
    return {
      id: row.id,
      invoiceRecordId: row.invoiceRecordId,
      targetConnectionId: row.targetConnectionId,
      status: readStatus(row.status),
      attempts: row.attempts,
      lastFailureCode: readFailureCode(row.lastFailureCode),
      uploadedAt: row.uploadedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/** An unrecognised stored value reads as `failed`, the one state a retry can still change. */
const readStatus = (value: string): InvoiceMarketplaceUploadStatus =>
  (InvoiceMarketplaceUploadStatusValues as readonly string[]).includes(value)
    ? (value as InvoiceMarketplaceUploadStatus)
    : 'failed';

const readFailureCode = (value: string | null): InvoiceMarketplaceUploadFailureCode | null =>
  value !== null && (InvoiceMarketplaceUploadFailureCodeValues as readonly string[]).includes(value)
    ? (value as InvoiceMarketplaceUploadFailureCode)
    : null;
