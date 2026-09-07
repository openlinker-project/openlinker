/**
 * Shipment Line Repository (#2727)
 *
 * TypeORM implementation of `ShipmentLineRepositoryPort`. Handles all ORM ↔
 * domain mapping privately; callers receive domain shapes only.
 *
 * Two properties are load-bearing rather than incidental:
 *
 * - **Idempotency is the unique INDEX, never an application check.** Both
 *   writers use `INSERT … ON CONFLICT DO NOTHING`, because at READ COMMITTED a
 *   plain `SELECT` takes no locks and the conflicting row is a phantom that
 *   cannot be locked before it exists (the #2360 / #2392 idiom).
 * - **`foldCounters` is a TOTAL recompute.** The acts are authoritative and the
 *   counters denormalise them, so re-running the fold converges rather than
 *   double-counting — which is also what makes the runtime path convergent over
 *   whatever the backfill migration wrote.
 *
 * @module libs/core/src/shipping/infrastructure/persistence/repositories
 * @implements {ShipmentLineRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type {
  OrderLineQuantities,
  RecordShipmentLineActInput,
  ShipmentLineRepositoryPort,
  UpsertShipmentLineInput,
} from '../../../domain/ports/shipment-line-repository.port';
import type { ShipmentDirection } from '../../../domain/types/shipment-direction.types';
import type { ShipmentLine } from '../../../domain/types/shipment-line.types';
import { ShipmentLineOrmEntity } from '../entities/shipment-line.orm-entity';
import { ShipmentLineEventOrmEntity } from '../entities/shipment-line-event.orm-entity';

@Injectable()
export class ShipmentLineRepository implements ShipmentLineRepositoryPort {
  constructor(
    @InjectRepository(ShipmentLineOrmEntity)
    private readonly lines: Repository<ShipmentLineOrmEntity>,
    @InjectRepository(ShipmentLineEventOrmEntity)
    private readonly acts: Repository<ShipmentLineEventOrmEntity>,
  ) {}

  async upsertLines(input: readonly UpsertShipmentLineInput[]): Promise<void> {
    if (input.length === 0) return;

    await this.lines
      .createQueryBuilder()
      .insert()
      .into(ShipmentLineOrmEntity)
      .values(
        input.map((line) => ({
          shipmentId: line.shipmentId,
          orderId: line.orderId,
          lineId: line.lineId,
          productVariantId: line.productVariantId,
          quantity: line.quantity,
        })),
      )
      // Bare `orIgnore`: `quantity` is deliberately NOT rewritten on conflict —
      // a later order edit must not retroactively restate what an
      // already-shipped parcel undertook.
      .orIgnore()
      .execute();
  }

  async recordActs(input: readonly RecordShipmentLineActInput[]): Promise<void> {
    if (input.length === 0) return;

    await this.acts
      .createQueryBuilder()
      .insert()
      .into(ShipmentLineEventOrmEntity)
      .values(
        input.map((act) => ({
          shipmentLineId: act.shipmentLineId,
          kind: act.kind,
          quantity: act.quantity,
          occurredAt: act.occurredAt,
        })),
      )
      .orIgnore()
      .execute();
  }

  async foldCounters(shipmentIds: readonly string[]): Promise<void> {
    if (shipmentIds.length === 0) return;

    // A total recompute of every named shipment's lines, including the ones with
    // no acts at all — hence the LEFT JOIN and the COALESCE, which is what lets
    // this reset a counter as well as raise one.
    await this.lines.query(
      `UPDATE "shipment_lines" sl
          SET "shippedQuantity"   = COALESCE(f.ship, 0),
              "deliveredQuantity" = COALESCE(f.deliver, 0),
              "cancelledQuantity" = COALESCE(f.cancel, 0),
              "updatedAt"         = now()
         FROM (
           SELECT l."id" AS line_id,
                  SUM(e."quantity") FILTER (WHERE e."kind" = 'ship')    AS ship,
                  SUM(e."quantity") FILTER (WHERE e."kind" = 'deliver') AS deliver,
                  SUM(e."quantity") FILTER (WHERE e."kind" = 'cancel')  AS cancel
             FROM "shipment_lines" l
             LEFT JOIN "shipment_line_events" e ON e."shipmentLineId" = l."id"
            WHERE l."shipmentId" = ANY($1)
            GROUP BY l."id"
         ) f
        WHERE f.line_id = sl."id"`,
      [[...shipmentIds]],
    );
  }

  async findByShipmentIds(shipmentIds: readonly string[]): Promise<readonly ShipmentLine[]> {
    if (shipmentIds.length === 0) return [];

    const rows = await this.lines.find({ where: { shipmentId: In([...shipmentIds]) } });
    return rows.map((row) => this.toDomain(row));
  }

  async findOrderLineQuantities(
    orderId: string,
    direction: ShipmentDirection,
  ): Promise<readonly OrderLineQuantities[]> {
    // The direction filter is the JOIN's, not the line's — `direction` lives on
    // `shipments` and stays there (see the port's docblock).
    //
    // `GREATEST(…, 0)` on the net is belt-and-braces over
    // `CHK_shipment_lines_capacity`'s `cancelled <= shipped`: a negative net
    // would silently under-report an order's shipped units, and the clamp costs
    // nothing.
    const rows = (await this.lines.query(
      `SELECT sl."lineId" AS "lineId",
              COALESCE(SUM(GREATEST(sl."shippedQuantity" - sl."cancelledQuantity", 0)), 0)::int
                AS "netShipped",
              COALESCE(SUM(sl."deliveredQuantity"), 0)::int AS "delivered"
         FROM "shipment_lines" sl
         JOIN "shipments" s ON s."id" = sl."shipmentId"
        WHERE sl."orderId" = $1 AND s."direction" = $2
        GROUP BY sl."lineId"`,
      [orderId, direction],
    )) as { lineId: string; netShipped: number; delivered: number }[];

    return rows.map((row) => ({
      lineId: row.lineId,
      netShipped: Number(row.netShipped),
      delivered: Number(row.delivered),
    }));
  }

  private toDomain(entity: ShipmentLineOrmEntity): ShipmentLine {
    return {
      id: entity.id,
      shipmentId: entity.shipmentId,
      orderId: entity.orderId,
      lineId: entity.lineId,
      productVariantId: entity.productVariantId,
      quantity: entity.quantity,
      shippedQuantity: entity.shippedQuantity,
      deliveredQuantity: entity.deliveredQuantity,
      cancelledQuantity: entity.cancelledQuantity,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
