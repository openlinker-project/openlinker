/**
 * Return Repository
 *
 * TypeORM implementation of `ReturnRepositoryPort` (#2327, ADR-060).
 *
 * **Ids are minted with `formatInternalId('Return')`**, which falls through to
 * the lowercased default and yields `ol_return_*`. That is deliberate and
 * complete: there is NO `ENTITY_TYPE_ID_PREFIX` override and NO
 * `CoreEntityTypeValues` member, because that union is the *external-mapping*
 * vocabulary and a return is not mapped through `identifier_mappings` —
 * `externalReturnId` is a column on the row itself, resolved by the partial
 * unique index rather than by the mapping service. A later reader should not
 * "fix" the omission. Same shape as `LocationRepository`'s
 * `formatInternalId('Location')` and `ShipmentRepository`'s `'Shipment'`.
 *
 * The header and its lines are written in ONE transaction: a return without its
 * lines is not a return, so a partial write must never be observable — least of
 * all by #2328's update-or-create, which would read the header, find no lines,
 * and conclude the source had sent none.
 *
 * @module libs/core/src/returns/infrastructure/persistence/repositories
 * @implements {ReturnRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { formatInternalId } from '@openlinker/core/identifier-mapping';
import { RefundReasonValues } from '@openlinker/core/orders/types';
import type { RefundReason } from '@openlinker/core/orders/types';
import { Logger } from '@openlinker/shared/logging';
import { ReturnOrmEntity } from '../entities/return.orm-entity';
import { ReturnLineOrmEntity } from '../entities/return-line.orm-entity';
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import { ReturnLine } from '../../../domain/entities/return-line.entity';
import type { ReturnRepositoryPort } from '../../../domain/ports/return-repository.port';
import type { CreateReturnRecordInput, ReturnOrigin } from '../../../domain/types/return.types';
import type {
  ReturnCustodyState,
  ReturnDisposition,
  ReturnMoneyState,
} from '../../../domain/types/return-line.types';

@Injectable()
export class ReturnRepository implements ReturnRepositoryPort {
  private readonly logger = new Logger(ReturnRepository.name);

  constructor(
    @InjectRepository(ReturnOrmEntity)
    private readonly returns: Repository<ReturnOrmEntity>,
    @InjectRepository(ReturnLineOrmEntity)
    private readonly lines: Repository<ReturnLineOrmEntity>,
    private readonly dataSource: DataSource
  ) {}

  async create(input: CreateReturnRecordInput): Promise<ReturnRecord> {
    const header = new ReturnOrmEntity();
    header.id = formatInternalId('Return');
    header.sourceConnectionId = input.sourceConnectionId;
    header.externalReturnId = input.externalReturnId;
    header.internalOrderId = input.internalOrderId;
    header.origin = input.origin;
    header.rawStatus = input.rawStatus;
    header.rawPayload = input.rawPayload;
    header.openedAt = input.openedAt;
    header.authorizedAt = input.authorizedAt;
    header.declinedAt = input.declinedAt;
    header.closedAt = input.closedAt;

    const lineEntities = input.lines.map((line) => {
      const entity = new ReturnLineOrmEntity();
      entity.returnId = header.id;
      entity.lineIndex = line.lineIndex;
      entity.externalLineId = line.externalLineId;
      entity.resolvedOrderLineId = line.resolvedOrderLineId;
      entity.offerId = line.offerId;
      entity.sku = line.sku;
      entity.name = line.name;
      entity.reason = line.reason;
      entity.quantityAdvised = line.quantityAdvised;
      entity.note = line.note;
      return entity;
    });

    // One transaction — see the class docblock.
    const { savedHeader, savedLines } = await this.dataSource.transaction(async (manager) => {
      const persistedHeader = await manager.save(ReturnOrmEntity, header);
      const persistedLines =
        lineEntities.length === 0
          ? []
          : await manager.save(ReturnLineOrmEntity, lineEntities);
      return { savedHeader: persistedHeader, savedLines: persistedLines };
    });

    return this.toDomain(savedHeader, savedLines);
  }

  async findById(id: string): Promise<ReturnRecord | null> {
    const header = await this.returns.findOne({ where: { id } });
    if (!header) {
      return null;
    }
    const lines = await this.lines.find({
      where: { returnId: id },
      order: { lineIndex: 'ASC' },
    });
    return this.toDomain(header, lines);
  }

  async findByExternalId(
    sourceConnectionId: string,
    externalReturnId: string
  ): Promise<ReturnRecord | null> {
    const header = await this.returns.findOne({
      where: { sourceConnectionId, externalReturnId },
    });
    if (!header) {
      return null;
    }
    const lines = await this.lines.find({
      where: { returnId: header.id },
      order: { lineIndex: 'ASC' },
    });
    return this.toDomain(header, lines);
  }

  /**
   * Headers only, by design — the orphan bucket is a triage list, and hydrating
   * every line for every row would be an N+1 for data the list does not render.
   * A caller that needs the lines has the id and can call `findById`.
   */
  async listOrphans(limit: number, offset: number): Promise<ReturnRecord[]> {
    const headers = await this.returns.find({
      where: { internalOrderId: IsNull() },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return headers.map((header) => this.toDomain(header, []));
  }

  private toDomain(header: ReturnOrmEntity, lines: ReturnLineOrmEntity[]): ReturnRecord {
    return new ReturnRecord(
      header.id,
      header.sourceConnectionId,
      header.externalReturnId,
      header.internalOrderId,
      header.origin as ReturnOrigin,
      header.rawStatus,
      header.rawPayload,
      header.openedAt,
      header.authorizedAt,
      header.declinedAt,
      header.closedAt,
      header.createdAt,
      header.updatedAt,
      lines.map((line) => this.toLineDomain(line))
    );
  }

  private toLineDomain(entity: ReturnLineOrmEntity): ReturnLine {
    return new ReturnLine(
      entity.id,
      entity.returnId,
      entity.lineIndex,
      entity.externalLineId,
      entity.resolvedOrderLineId,
      entity.offerId,
      entity.sku,
      entity.name,
      this.toRefundReason(entity.reason),
      // `integer` comes back from pg as a number already, but a DEFAULT-ed
      // column read through an older row could be undefined; coerce once here
      // so no consumer ever sees a stringly-typed or absent counter.
      Number(entity.quantityAdvised),
      Number(entity.quantityReceived),
      Number(entity.quantityRestocked),
      Number(entity.quantityScrapped),
      entity.custodyState as ReturnCustodyState,
      entity.moneyState as ReturnMoneyState,
      entity.disposition as ReturnDisposition | null,
      entity.receivedAt,
      entity.disposedAt,
      entity.note,
      entity.createdAt,
      entity.updatedAt
    );
  }

  /**
   * Typed, fail-safe read of the stored `reason` column — the same
   * narrow-or-fallback pattern `RefundRecordRepository.toRefundReason` uses,
   * and for the same reason: a row written before a future reason was removed
   * from `RefundReasonValues`, or inserted by a caller that bypassed the DTO
   * validator, should degrade to `'other'` with a warning rather than hand out
   * a value outside the union.
   */
  private toRefundReason(rawReason: string): RefundReason {
    if ((RefundReasonValues as readonly string[]).includes(rawReason)) {
      return rawReason as RefundReason;
    }
    this.logger.warn(`Unrecognised return reason "${rawReason}" — falling back to "other"`);
    return 'other';
  }
}
