/**
 * Shipment Repository
 *
 * TypeORM implementation of `ShipmentRepositoryPort`. Handles all ORM ↔
 * domain mapping privately; callers receive domain `Shipment` entities
 * only. Generates the `ol_shipment_*` internal id via `formatInternalId`
 * at create-time (no `IdentifierMappingService` call — `Shipment` is not
 * cross-platform-mapped).
 *
 * Throws `ShipmentNotFoundException` from `update()` when no row matches.
 *
 * @module libs/core/src/shipping/infrastructure/persistence/repositories
 * @implements {ShipmentRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  type FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';

import { formatInternalId } from '@openlinker/core/identifier-mapping';

import { Shipment } from '../../../domain/entities/shipment.entity';
import { ShipmentNotFoundException } from '../../../domain/exceptions/shipment-not-found.exception';
import type { ShipmentRepositoryPort } from '../../../domain/ports/shipment-repository.port';
import {
  ReservationConsumeCandidateStatusValues,
  TerminalShipmentStatusValues,
} from '../../../domain/types/shipment-status.types';
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
} from '../../../domain/types/shipment-query.types';
import type { ShipmentDirection } from '../../../domain/types/shipment-direction.types';
import {
  readWaybillRelayFailureReason,
  type RecordWaybillRelayFailureInput,
  type WaybillRelayFailure,
} from '../../../domain/types/waybill-relay-failure.types';
import type {
  CreateShipmentInput,
  UpdateShipmentInput,
} from '../../../domain/types/shipment.types';
import { ShipmentOrmEntity } from '../entities/shipment.orm-entity';

@Injectable()
export class ShipmentRepository implements ShipmentRepositoryPort {
  constructor(
    @InjectRepository(ShipmentOrmEntity)
    private readonly repository: Repository<ShipmentOrmEntity>,
  ) {}

  async create(input: CreateShipmentInput): Promise<Shipment> {
    const entity = this.buildOrmEntity(input);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findMany(
    filters: ShipmentFilters,
    pagination: ShipmentPagination,
  ): Promise<PaginatedShipments> {
    const where = this.buildWhere(filters);
    const [entities, total] = await this.repository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items: entities.map((entity) => this.toDomain(entity)), total };
  }

  async findById(id: string): Promise<Shipment | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByOrderId(
    orderId: string,
    direction: ShipmentDirection,
  ): Promise<readonly Shipment[]> {
    const entities = await this.repository.find({
      where: { orderId, direction },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findActiveByOrderId(
    orderId: string,
    direction: ShipmentDirection,
  ): Promise<Shipment | null> {
    const entity = await this.repository.findOne({
      where: {
        orderId,
        direction,
        status: Not(In([...TerminalShipmentStatusValues])),
      },
      order: { createdAt: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findByFulfillmentWorkIds(
    workIds: readonly string[],
    direction: ShipmentDirection,
  ): Promise<readonly Shipment[]> {
    // `IN ()` is a Postgres syntax error, not an empty set — and an empty ask
    // has an answer that needs no round trip.
    if (workIds.length === 0) return [];

    const entities = await this.repository.find({
      where: { fulfillmentWorkId: In([...workIds]), direction },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findByProviderShipmentId(providerShipmentId: string): Promise<Shipment | null> {
    const entity = await this.repository.findOne({ where: { providerShipmentId } });
    return entity ? this.toDomain(entity) : null;
  }

  async findBranchOneByOrderAndConnection(
    orderId: string,
    connectionId: string,
    direction: ShipmentDirection,
  ): Promise<Shipment | null> {
    // Matches the partial-unique index `UQ_shipments_branch_one_per_order_conn`
    // key-for-key — including `direction`, which #2373 added to its KEY columns
    // — so the lookup hits exactly the row the index protects against: at most
    // one row by construction. Dropping `direction` here would match a sibling
    // row the index deliberately permits.
    const entity = await this.repository.findOne({
      where: {
        orderId,
        connectionId,
        direction,
        providerShipmentId: IsNull(),
      },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async update(id: string, patch: UpdateShipmentInput): Promise<Shipment> {
    const result = await this.repository.update({ id }, this.buildUpdatePayload(patch));
    if (result.affected === 0) {
      throw new ShipmentNotFoundException(id);
    }
    const refreshed = await this.repository.findOne({ where: { id } });
    if (!refreshed) {
      // Defensive — the row was deleted between the update and the read.
      // Treat as not-found so callers see one consistent failure mode.
      throw new ShipmentNotFoundException(id);
    }
    return this.toDomain(refreshed);
  }

  async claimWaybillRelay(id: string, at: Date): Promise<boolean> {
    // Conditional write — `IsNull()` in the WHERE is what makes this atomic
    // under two concurrent triggers (poll + carrier webhook). Exactly one
    // UPDATE can affect a row.
    const result = await this.repository.update(
      { id, waybillRelayedAt: IsNull() },
      { waybillRelayedAt: at },
    );
    return (result.affected ?? 0) > 0;
  }

  async claimFulfillmentWorkLink(id: string, fulfillmentWorkId: string): Promise<boolean> {
    // Conditional write — `IsNull()` in the WHERE is what makes this atomic
    // under two concurrent observers (a dispatch and the branch-1 status poll).
    // Exactly one UPDATE can affect a row; an application-side null check would
    // enforce nothing at READ COMMITTED.
    const result = await this.repository.update(
      { id, fulfillmentWorkId: IsNull() },
      { fulfillmentWorkId },
    );
    return (result.affected ?? 0) > 0;
  }

  async listDispatchedAwaitingReservationConsume(limit: number): Promise<readonly Shipment[]> {
    // Frontier-as-query: the predicate IS the cursor (see the port docblock).
    // `createdAt ASC` so the longest-outstanding shipment is examined first.
    const entities = await this.repository.find({
      where: {
        // Outbound only. #2347 was written when every row in this table was a
        // seller-to-buyer dispatch; #2373 put return labels in the same table,
        // and they reach the very statuses this predicate selects on. An
        // inbound parcel arriving would otherwise become a consume candidate
        // and close the order's holds — concluding "the goods left the
        // building" from one coming back.
        direction: 'outbound',
        status: In([...ReservationConsumeCandidateStatusValues]),
        reservationConsumedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async claimReservationConsume(id: string, at: Date): Promise<boolean> {
    // Conditional write — `IsNull()` in the WHERE is what makes this atomic:
    // exactly one UPDATE can affect the row. `?? 0` matters, not style: an
    // `undefined` affected count coercing to a truthy claim is the silent
    // double-consume shape.
    const result = await this.repository.update(
      { id, reservationConsumedAt: IsNull() },
      { reservationConsumedAt: at },
    );
    return (result.affected ?? 0) > 0;
  }

  async releaseWaybillRelay(
    id: string,
    failure: RecordWaybillRelayFailureInput,
  ): Promise<void> {
    // Unconditional: only the claim holder calls this, and re-releasing an
    // already-NULL row is harmless.
    //
    // The release and the failure record are ONE statement (#2073), so a
    // release that does not count is not expressible.
    //
    // Raw parameterized SQL rather than the object form of `update()`, because
    // the increment and the COALESCE are expressions that form cannot carry —
    // the same shape, and for the same reason, as the `webhook_auth_rejections`
    // rolling counter (#1814). Values are bound, never interpolated.
    //
    // `firstFailedAt` is COALESCE'd so it marks the start of the CURRENT run
    // rather than being overwritten on every attempt, which is what lets an
    // operator see how long a relay has been stuck. `updatedAt` is bumped
    // explicitly: a raw statement does not fire `@UpdateDateColumn`, and the
    // `repository.update()` call this replaces did bump it.
    await this.repository.query(
      `UPDATE "shipments"
          SET "waybillRelayedAt" = NULL,
              "waybillRelayFailureCount" = "waybillRelayFailureCount" + 1,
              "waybillRelayFirstFailedAt" = COALESCE("waybillRelayFirstFailedAt", $2),
              "waybillRelayLastFailedAt" = $2,
              "waybillRelayLastFailureReason" = $3,
              "waybillRelayLastFailureConnectionId" = $4,
              "updatedAt" = now()
        WHERE "id" = $1`,
      [id, failure.failedAt, failure.reason, failure.connectionId],
    );
  }

  async clearWaybillRelayFailures(id: string): Promise<void> {
    // Guarded on `> 0` so the healthy case - every relay that has never failed
    // - matches zero rows and writes nothing. Idempotent either way.
    await this.repository.update(
      { id, waybillRelayFailureCount: MoreThan(0) },
      {
        waybillRelayFailureCount: 0,
        waybillRelayFirstFailedAt: null,
        waybillRelayLastFailedAt: null,
        waybillRelayLastFailureReason: null,
        waybillRelayLastFailureConnectionId: null,
      },
    );
  }

  private buildOrmEntity(input: CreateShipmentInput): ShipmentOrmEntity {
    const entity = new ShipmentOrmEntity();
    entity.id = formatInternalId('Shipment');
    entity.orderId = input.orderId;
    entity.connectionId = input.connectionId;
    // The ONE application-side default for `direction` (#2373). The DB column
    // carries none, so an insert that bypasses this builder fails loudly
    // rather than silently acquiring a cohort.
    entity.direction = input.direction ?? 'outbound';
    entity.shippingMethod = input.shippingMethod;
    entity.deliveryIntent = input.deliveryIntent ?? null;
    // Atomic-terminal mode (#834): when `initialStatus` is supplied (the
    // branch-1 projection path), the row is born at its correct status +
    // terminal timestamps + tracking number. Default `'draft'` preserves
    // the dispatch path's two-step `create(draft) → update(generated)` flow.
    entity.status = input.initialStatus ?? 'draft';
    entity.providerShipmentId = null;
    entity.paczkomatId = input.paczkomatId ?? null;
    entity.sourceDeliveryMethodId = input.sourceDeliveryMethodId ?? null;
    entity.trackingNumber = input.trackingNumber ?? null;
    entity.labelPdfRef = null;
    entity.dispatchedAt = input.dispatchedAt ?? null;
    entity.deliveredAt = input.deliveredAt ?? null;
    entity.cancelledAt = input.cancelledAt ?? null;
    entity.failedAt = null;
    entity.errorMessage = null;
    entity.carrier = null;
    entity.providerCode = null;
    // Unclaimed at birth (#1947) — even on the atomic-terminal branch-1 path,
    // which is born with a `trackingNumber` but has told no source yet.
    entity.waybillRelayedAt = null;
    // Unclaimed at birth (#2347) — even a branch-1 row born terminal has not had
    // its order's reservations consumed yet; the sweep is what does that.
    entity.reservationConsumedAt = null;
    // Work linkage (#2402). Written HERE and only here: `create` persists a
    // fully-populated entity, so omitting this line would not fail to compile —
    // `save` would simply write NULL on every row, silently. That is why the
    // spec asserts the PERSISTED value rather than the call argument.
    entity.fulfillmentWorkId = input.fulfillmentWorkId ?? null;
    // No relay failures at birth (#2073). The count is assigned EXPLICITLY
    // rather than left to the column default: `save` on a fully-populated
    // entity would otherwise emit `DEFAULT` for it, making the insert depend on
    // a default that a `synchronize`-built schema takes from the decorator and
    // a migration-built one from the DDL (`docs/lessons.md`, out-of-band-UPDATE
    // entry, trap 2). Assigning here means the insert depends on neither.
    entity.waybillRelayFailureCount = 0;
    entity.waybillRelayFirstFailedAt = null;
    entity.waybillRelayLastFailedAt = null;
    entity.waybillRelayLastFailureReason = null;
    entity.waybillRelayLastFailureConnectionId = null;
    return entity;
  }

  private buildWhere(filters: ShipmentFilters): FindOptionsWhere<ShipmentOrmEntity> {
    const where: FindOptionsWhere<ShipmentOrmEntity> = {};
    if (filters.orderId !== undefined) where.orderId = filters.orderId;
    if (filters.direction !== undefined) where.direction = filters.direction;
    // `statuses` (multi-status IN) takes precedence over `status` when both
    // are set (#838 — see ShipmentFilters jsdoc).
    if (filters.statuses !== undefined && filters.statuses.length > 0) {
      where.status = In([...filters.statuses]);
    } else if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.connectionId !== undefined) where.connectionId = filters.connectionId;
    if (filters.shippingMethod !== undefined) where.shippingMethod = filters.shippingMethod;
    if (filters.hasTracking !== undefined) {
      where.trackingNumber = filters.hasTracking ? Not(IsNull()) : IsNull();
    }
    if (filters.hasProviderShipmentId !== undefined) {
      where.providerShipmentId = filters.hasProviderShipmentId ? Not(IsNull()) : IsNull();
    }
    // #2073. A numeric floor, never a "stuck" boolean — the repository is not
    // where the policy of which number means stuck belongs.
    if (filters.waybillRelayFailureCountAtLeast !== undefined) {
      where.waybillRelayFailureCount = MoreThanOrEqual(filters.waybillRelayFailureCountAtLeast);
    }
    const { createdFrom, createdTo } = filters;
    if (createdFrom !== undefined && createdTo !== undefined) {
      where.createdAt = Between(createdFrom, createdTo);
    } else if (createdFrom !== undefined) {
      where.createdAt = MoreThanOrEqual(createdFrom);
    } else if (createdTo !== undefined) {
      where.createdAt = LessThanOrEqual(createdTo);
    }
    return where;
  }

  private buildUpdatePayload(patch: UpdateShipmentInput): Partial<ShipmentOrmEntity> {
    const payload: Partial<ShipmentOrmEntity> = {};
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.shippingMethod !== undefined) payload.shippingMethod = patch.shippingMethod;
    if (patch.deliveryIntent !== undefined) payload.deliveryIntent = patch.deliveryIntent;
    if (patch.paczkomatId !== undefined) payload.paczkomatId = patch.paczkomatId;
    if (patch.sourceDeliveryMethodId !== undefined) {
      payload.sourceDeliveryMethodId = patch.sourceDeliveryMethodId;
    }
    if (patch.providerShipmentId !== undefined) {
      payload.providerShipmentId = patch.providerShipmentId;
    }
    if (patch.trackingNumber !== undefined) payload.trackingNumber = patch.trackingNumber;
    if (patch.labelPdfRef !== undefined) payload.labelPdfRef = patch.labelPdfRef;
    if (patch.dispatchedAt !== undefined) payload.dispatchedAt = patch.dispatchedAt;
    if (patch.deliveredAt !== undefined) payload.deliveredAt = patch.deliveredAt;
    if (patch.cancelledAt !== undefined) payload.cancelledAt = patch.cancelledAt;
    if (patch.failedAt !== undefined) payload.failedAt = patch.failedAt;
    if (patch.errorMessage !== undefined) payload.errorMessage = patch.errorMessage;
    if (patch.carrier !== undefined) payload.carrier = patch.carrier;
    if (patch.providerCode !== undefined) payload.providerCode = patch.providerCode;
    return payload;
  }

  private toDomain(entity: ShipmentOrmEntity): Shipment {
    return new Shipment(
      entity.id,
      entity.orderId,
      entity.connectionId,
      entity.shippingMethod,
      entity.status,
      entity.providerShipmentId,
      entity.paczkomatId,
      entity.trackingNumber,
      entity.labelPdfRef,
      entity.dispatchedAt,
      entity.deliveredAt,
      entity.cancelledAt,
      entity.failedAt,
      entity.errorMessage,
      entity.createdAt,
      entity.updatedAt,
      entity.sourceDeliveryMethodId,
      entity.carrier,
      entity.deliveryIntent,
      entity.providerCode,
      entity.waybillRelayedAt,
      entity.direction,
      entity.reservationConsumedAt,
      entity.fulfillmentWorkId,
      this.toWaybillRelayFailure(entity),
    );
  }

  /**
   * Project the five failure columns into one value object, or `null` (#2073).
   *
   * `null` is the single representation of healthy, so the gate is the COUNT
   * rather than the presence of a timestamp. The two timestamps are asserted
   * non-null before the object is built: a positive count without them would be
   * a row no writer here can produce, and fabricating an instant to satisfy the
   * type would put a false fact on an operator's screen — so such a row reads
   * as no failure history rather than as an invented one.
   */
  private toWaybillRelayFailure(entity: ShipmentOrmEntity): WaybillRelayFailure | null {
    if (
      entity.waybillRelayFailureCount <= 0 ||
      entity.waybillRelayFirstFailedAt === null ||
      entity.waybillRelayLastFailedAt === null
    ) {
      return null;
    }
    return {
      count: entity.waybillRelayFailureCount,
      firstFailedAt: entity.waybillRelayFirstFailedAt,
      lastFailedAt: entity.waybillRelayLastFailedAt,
      // Coerced, so a value this build does not recognise reads as absent
      // rather than being asserted onward to a frontend that cannot render it.
      reason: readWaybillRelayFailureReason(entity.waybillRelayLastFailureReason),
      connectionId: entity.waybillRelayLastFailureConnectionId,
    };
  }
}
