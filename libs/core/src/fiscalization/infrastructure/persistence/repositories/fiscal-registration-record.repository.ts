/**
 * Fiscal Registration Record Repository
 *
 * TypeORM implementation of `FiscalRegistrationRecordRepositoryPort`. Maps
 * ORM <-> domain privately; callers receive domain entities only, and the
 * Postgres unique violation on the exactly-once index is converted into a domain
 * error so `QueryFailedError` never reaches the application layer.
 *
 * `claimForRegistration` is the one method here that is not plumbing: it carries
 * half of the exactly-once guarantee, as a single guarded UPDATE whose predicate
 * encodes the fiscal-safety invariant at the persistence boundary.
 *
 * @module libs/core/src/fiscalization/infrastructure/persistence/repositories
 * @implements {FiscalRegistrationRecordRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';

import { FiscalRegistrationRecord } from '../../../domain/entities/fiscal-registration-record.entity';
import { DuplicateFiscalRegistrationRecordException } from '../../../domain/exceptions/duplicate-fiscal-registration-record.exception';
import { FiscalRegistrationRecordNotFoundException } from '../../../domain/exceptions/fiscal-registration-record-not-found.exception';
import type { FiscalRegistrationRecordRepositoryPort } from '../../../domain/ports/fiscal-registration-record-repository.port';
import type {
  CreateFiscalRegistrationRecordInput,
  FiscalRegistrationOutcomePatch,
} from '../../../domain/types/fiscalization.types';
import { FiscalRegistrationRecordOrmEntity } from '../entities/fiscal-registration-record.orm-entity';

@Injectable()
export class FiscalRegistrationRecordRepository
  implements FiscalRegistrationRecordRepositoryPort
{
  constructor(
    @InjectRepository(FiscalRegistrationRecordOrmEntity)
    private readonly repository: Repository<FiscalRegistrationRecordOrmEntity>,
  ) {}

  async create(
    input: CreateFiscalRegistrationRecordInput,
  ): Promise<FiscalRegistrationRecord> {
    const entity = new FiscalRegistrationRecordOrmEntity();
    entity.connectionId = input.connectionId;
    entity.orderId = input.orderId;
    entity.providerType = input.providerType;
    entity.idempotencyKey = input.idempotencyKey;
    entity.status = input.status;

    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (error instanceof QueryFailedError && error.message.includes('duplicate key')) {
        throw new DuplicateFiscalRegistrationRecordException(
          input.connectionId,
          input.idempotencyKey,
        );
      }
      throw error;
    }
  }

  async findById(id: string): Promise<FiscalRegistrationRecord | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByIdempotencyKey(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<FiscalRegistrationRecord | null> {
    const entity = await this.repository.findOne({
      where: { connectionId, idempotencyKey },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findAllByOrderId(orderId: string): Promise<FiscalRegistrationRecord[]> {
    const entities = await this.repository.find({
      where: { orderId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findAllByOrderIds(orderIds: readonly string[]): Promise<FiscalRegistrationRecord[]> {
    if (orderIds.length === 0) {
      return [];
    }
    const entities = await this.repository.find({
      where: { orderId: In([...orderIds]) },
      order: { orderId: 'ASC', createdAt: 'DESC', id: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async updateOutcome(
    id: string,
    patch: FiscalRegistrationOutcomePatch,
  ): Promise<FiscalRegistrationRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new FiscalRegistrationRecordNotFoundException(id);
    }

    // Only the keys the caller actually supplied are applied - an omitted key
    // must never be read as "set to null".
    if (patch.status !== undefined) entity.status = patch.status;
    if (patch.providerType !== undefined) entity.providerType = patch.providerType;
    if (patch.providerReference !== undefined) {
      entity.providerReference = patch.providerReference;
    }
    if (patch.documentReference !== undefined) {
      entity.documentReference = patch.documentReference;
    }
    if (patch.signingIdentity !== undefined) entity.signingIdentity = patch.signingIdentity;
    if (patch.registeredAt !== undefined) entity.registeredAt = patch.registeredAt;
    if (patch.regimeExtras !== undefined) entity.regimeExtras = patch.regimeExtras;
    if (patch.artefacts !== undefined) entity.artefacts = patch.artefacts;
    if (patch.failureMode !== undefined) entity.failureMode = patch.failureMode;
    if (patch.failureReason !== undefined) entity.failureReason = patch.failureReason;
    if (patch.errorMessage !== undefined) entity.errorMessage = patch.errorMessage;
    if (patch.leaseExpiresAt !== undefined) entity.leaseExpiresAt = patch.leaseExpiresAt;

    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async claimForRegistration(
    id: string,
    leaseExpiresAt: Date,
  ): Promise<FiscalRegistrationRecord | null> {
    const now = new Date();
    const result = await this.repository
      .createQueryBuilder()
      .update(FiscalRegistrationRecordOrmEntity)
      .set({ status: 'registering', leaseExpiresAt })
      .where('id = :id', { id })
      .andWhere(
        // Claimable iff NOT held by a live attempt, NOT already registered, and
        // NOT an in-doubt failure (the sale may already be registered):
        //   - pending (no lease by definition), OR
        //   - a TERMINAL-`rejected` failed row (the provider created nothing), OR
        //   - registering with an EXPIRED lease (a crashed prior attempt).
        // A `registered`, an in-doubt/mode-less `failed`, or a live `registering`
        // row NEVER matches, so none can be re-claimed and re-sent.
        `(status = 'pending'
          OR (status = 'failed' AND "failureMode" = 'rejected')
          OR (status = 'registering' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= :now)))`,
        { now },
      )
      // Single statement: RETURNING hands back the just-claimed row in the SAME
      // write, so there is no UPDATE -> read window in which another transaction
      // can mutate the row out from under the winner.
      .returning('*')
      .execute();

    if (result.affected && result.affected > 0) {
      const rawRows = (Array.isArray(result.raw) ? result.raw : []) as unknown[];
      const raw = rawRows[0] as Partial<FiscalRegistrationRecordOrmEntity> | undefined;
      if (raw) {
        return this.toDomain(this.repository.create(raw));
      }
      // Provably WON the claim but could not read the row back (a driver that
      // does not honour RETURNING). This attempt HOLDS the lease, so it must not
      // be reported as a contended loss - that would make the holder back off
      // and orphan the row. Re-read; fail loud rather than downgrade a win.
      const claimed = await this.repository.findOne({ where: { id } });
      if (claimed) {
        return this.toDomain(claimed);
      }
      throw new FiscalRegistrationRecordNotFoundException(id);
    }

    // No row updated: either the id does not exist, or the slot is held by a live
    // attempt / already registered / in doubt. Disambiguate so the contract can
    // throw not-found vs. signal a contended loss (`null`).
    const exists = await this.repository.findOne({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new FiscalRegistrationRecordNotFoundException(id);
    }
    return null;
  }

  private toDomain(entity: FiscalRegistrationRecordOrmEntity): FiscalRegistrationRecord {
    return new FiscalRegistrationRecord(
      entity.id,
      entity.connectionId,
      entity.orderId,
      entity.providerType,
      entity.idempotencyKey,
      entity.status,
      entity.providerReference ?? null,
      entity.documentReference ?? null,
      entity.signingIdentity ?? null,
      entity.registeredAt ?? null,
      entity.regimeExtras ?? null,
      entity.artefacts ?? null,
      entity.failureMode ?? null,
      entity.failureReason ?? null,
      entity.errorMessage ?? null,
      entity.leaseExpiresAt ?? null,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
