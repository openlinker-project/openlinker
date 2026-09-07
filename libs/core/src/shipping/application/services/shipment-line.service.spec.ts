/**
 * Unit tests for `ShipmentLineService` (#2727).
 *
 * The line-grain read model's one writer. What these pin, in order of how
 * expensive getting them wrong would be:
 *
 * - **`undefined` versus `{ordered, delivered}`.** Returning a zero coverage
 *   where there is no line data would demote every pre-backfill order out of
 *   the delivered bucket. Absent must mean "not known".
 * - **Act derivation.** A `cancel` is only ever emitted for a shipment that
 *   actually shipped, or the DB capacity CHECK refuses the fold.
 * - **`occurredAt` provenance.** The shipment's own instant, falling back to its
 *   immutable `createdAt` — never `updatedAt`, which is a KEY column on the act
 *   ledger and would mint a duplicate act on every reconcile.
 * - **The coverage clamp**, which is what keeps an over-attributed numerator
 *   from exceeding what the order actually requires.
 *
 * @module libs/core/src/shipping/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';

import { ShipmentLineService } from './shipment-line.service';
import type { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentStatus } from '../../domain/types/shipment-status.types';
import {
  SHIPMENT_LINE_REPOSITORY_TOKEN,
  SHIPMENT_LINE_SERVICE_TOKEN,
} from '../../shipping.tokens';

const ORDER_ID = 'ol_order_1';

const shipment = (
  over: Partial<{
    id: string;
    status: ShipmentStatus;
    dispatchedAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
    failedAt: Date | null;
    createdAt: Date;
  }> = {},
): Shipment =>
  ({
    id: over.id ?? 'ol_shipment_1',
    orderId: ORDER_ID,
    status: over.status ?? 'dispatched',
    dispatchedAt: over.dispatchedAt ?? null,
    deliveredAt: over.deliveredAt ?? null,
    cancelledAt: over.cancelledAt ?? null,
    failedAt: over.failedAt ?? null,
    createdAt: over.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-06-06T00:00:00Z'),
  }) as unknown as Shipment;

const readyRecord = (items: unknown[]): Record<string, unknown> => ({
  internalOrderId: ORDER_ID,
  recordStatus: 'ready',
  orderSnapshot: { items },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

describe('ShipmentLineService', () => {
  let service: ShipmentLineService;
  let lines: {
    upsertLines: jest.Mock;
    recordActs: jest.Mock;
    foldCounters: jest.Mock;
    findByShipmentIds: jest.Mock;
    findOrderLineQuantities: jest.Mock;
  };
  let orderRecords: { getOrderRecord: jest.Mock };

  beforeEach(async () => {
    lines = {
      upsertLines: jest.fn().mockResolvedValue(undefined),
      recordActs: jest.fn().mockResolvedValue(undefined),
      foldCounters: jest.fn().mockResolvedValue(undefined),
      findByShipmentIds: jest.fn().mockResolvedValue([]),
      findOrderLineQuantities: jest.fn().mockResolvedValue([]),
    };
    orderRecords = { getOrderRecord: jest.fn().mockResolvedValue(null) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentLineService,
        { provide: SHIPMENT_LINE_REPOSITORY_TOKEN, useValue: lines },
        { provide: ORDER_RECORD_SERVICE_TOKEN, useValue: orderRecords },
      ],
    }).compile();

    service = moduleRef.get(ShipmentLineService);
  });

  it('should be resolvable under its own service token shape', () => {
    // Guards the token existing at all — the wiring the draft was missing.
    expect(typeof SHIPMENT_LINE_SERVICE_TOKEN).toBe('symbol');
    expect(service).toBeInstanceOf(ShipmentLineService);
  });

  // ── "no line data" is not "zero delivered" ──────────────────────────────────

  it('should return undefined when the order record does not exist', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(null);

    await expect(service.reconcile(ORDER_ID, [shipment()])).resolves.toBeUndefined();
    expect(lines.upsertLines).not.toHaveBeenCalled();
  });

  it('should return undefined when the snapshot carries no items', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(readyRecord([]));

    await expect(service.reconcile(ORDER_ID, [shipment()])).resolves.toBeUndefined();
  });

  /**
   * An `awaiting_mapping` record makes `orderFromReadySnapshot` throw. The
   * caller is a best-effort projection, so this degrades to "no line data"
   * rather than propagating — a rollup that refuses to compute is worse than one
   * that computes without the coverage refinement.
   */
  it('should degrade to undefined rather than throw on a non-ready record', async () => {
    orderRecords.getOrderRecord.mockResolvedValue({
      ...readyRecord([{ id: 'l1', quantity: 1 }]),
      recordStatus: 'awaiting_mapping',
    });

    await expect(service.reconcile(ORDER_ID, [shipment()])).resolves.toBeUndefined();
  });

  it('should skip an item whose line id is blank rather than write a colliding row', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(
      readyRecord([
        { id: '', quantity: 2 },
        { id: 'l2', quantity: 3 },
      ]),
    );

    await service.reconcile(ORDER_ID, [shipment()]);

    expect(lines.upsertLines).toHaveBeenCalledWith([
      expect.objectContaining({ lineId: 'l2', quantity: 3 }),
    ]);
  });

  // ── Act derivation ─────────────────────────────────────────────────────────

  const seedOneLine = (quantity = 2): void => {
    orderRecords.getOrderRecord.mockResolvedValue(readyRecord([{ id: 'l1', quantity }]));
    lines.findByShipmentIds.mockResolvedValue([
      { id: 'sl1', shipmentId: 'ol_shipment_1', quantity },
    ]);
  };

  it('should emit ship at the shipment dispatch instant', async () => {
    seedOneLine();
    const dispatchedAt = new Date('2026-02-02T10:00:00Z');

    await service.reconcile(ORDER_ID, [shipment({ dispatchedAt })]);

    expect(lines.recordActs).toHaveBeenCalledWith([
      { shipmentLineId: 'sl1', kind: 'ship', quantity: 2, occurredAt: dispatchedAt },
    ]);
  });

  /**
   * A branch-1 projection row is born at its terminal status and may carry no
   * timestamp at all, so the status implies the departure.
   */
  it('should emit ship from status alone when no dispatch instant was recorded', async () => {
    seedOneLine();
    const createdAt = new Date('2026-03-03T09:00:00Z');

    await service.reconcile(ORDER_ID, [shipment({ status: 'in-transit', createdAt })]);

    expect(lines.recordActs).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'ship', occurredAt: createdAt }),
    ]);
  });

  /**
   * `updatedAt` moves on every write and `occurredAt` is a KEY column on the act
   * ledger, so falling back to it would mint a fresh duplicate act on every
   * single reconcile — an unbounded ledger and a permanently climbing counter.
   */
  it('should never fall back to the shipment updatedAt', async () => {
    seedOneLine();
    const ship = shipment({ status: 'delivered' });

    await service.reconcile(ORDER_ID, [ship]);

    const calls = lines.recordActs.mock.calls as [{ occurredAt: Date }[]][];
    const acts = calls[0][0];
    expect(acts.length).toBeGreaterThan(0);
    for (const act of acts) {
      expect(act.occurredAt).not.toEqual(ship.updatedAt);
      expect(act.occurredAt).toEqual(ship.createdAt);
    }
  });

  it('should emit ship and cancel for a dispatched shipment later cancelled', async () => {
    seedOneLine();
    const dispatchedAt = new Date('2026-01-01T10:00:00Z');
    const cancelledAt = new Date('2026-01-01T11:00:00Z');

    await service.reconcile(ORDER_ID, [
      shipment({ status: 'cancelled', dispatchedAt, cancelledAt }),
    ]);

    expect(lines.recordActs).toHaveBeenCalledWith([
      { shipmentLineId: 'sl1', kind: 'ship', quantity: 2, occurredAt: dispatchedAt },
      { shipmentLineId: 'sl1', kind: 'cancel', quantity: 2, occurredAt: cancelledAt },
    ]);
  });

  /**
   * The clause that keeps `cancelledQuantity <= shippedQuantity` true. A
   * shipment cancelled at `draft` never shipped, so there is nothing to reverse
   * — emitting a bare `cancel` would be refused by the DB capacity CHECK inside
   * a best-effort catch, i.e. silently.
   */
  it('should emit NO acts for a shipment cancelled before it ever shipped', async () => {
    seedOneLine();

    await service.reconcile(ORDER_ID, [
      shipment({ status: 'cancelled', cancelledAt: new Date('2026-01-01T11:00:00Z') }),
    ]);

    expect(lines.recordActs).toHaveBeenCalledWith([]);
  });

  it('should fall back to failedAt when a failed shipment carries no cancelledAt', async () => {
    seedOneLine();
    const failedAt = new Date('2026-04-04T12:00:00Z');

    await service.reconcile(ORDER_ID, [
      shipment({ status: 'failed', dispatchedAt: new Date('2026-04-04T10:00:00Z'), failedAt }),
    ]);

    expect(lines.recordActs).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'ship' }),
      expect.objectContaining({ kind: 'cancel', occurredAt: failedAt }),
    ]);
  });

  it('should fold counters for exactly the shipments it was given', async () => {
    seedOneLine();

    await service.reconcile(ORDER_ID, [shipment({ dispatchedAt: new Date() })]);

    expect(lines.foldCounters).toHaveBeenCalledWith(['ol_shipment_1']);
  });

  // ── Coverage ───────────────────────────────────────────────────────────────

  it('should read the coverage denominator from the order, scoped to outbound', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(
      readyRecord([
        { id: 'l1', quantity: 2 },
        { id: 'l2', quantity: 3 },
      ]),
    );
    lines.findOrderLineQuantities.mockResolvedValue([
      { lineId: 'l1', netShipped: 2, delivered: 2 },
    ]);

    const coverage = await service.reconcile(ORDER_ID, []);

    expect(coverage).toEqual({ ordered: 5, delivered: 2 });
    // A return label is a different cohort and must never contribute to a
    // statement about fulfilling the buyer's order (#2373 / ADR-060).
    expect(lines.findOrderLineQuantities).toHaveBeenCalledWith(ORDER_ID, 'outbound');
  });

  /**
   * The numerator over-attributes by design (each shipment of a line is credited
   * the line's full quantity), so without the clamp a two-package line could
   * report more delivered than the order ever required — and `delivered >=
   * ordered` would then hide a genuine shortfall on a SIBLING line.
   */
  it('should clamp a line delivered count to what that line ordered', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(
      readyRecord([
        { id: 'l1', quantity: 2 },
        { id: 'l2', quantity: 4 },
      ]),
    );
    lines.findOrderLineQuantities.mockResolvedValue([
      { lineId: 'l1', netShipped: 6, delivered: 6 },
      { lineId: 'l2', netShipped: 1, delivered: 1 },
    ]);

    const coverage = await service.reconcile(ORDER_ID, []);

    // Unclamped this would be 7 of 6 and read as fully delivered; clamped it is
    // 3 of 6 and correctly demotes.
    expect(coverage).toEqual({ ordered: 6, delivered: 3 });
  });

  it('should report zero delivered rather than undefined when lines exist but nothing shipped', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(readyRecord([{ id: 'l1', quantity: 2 }]));
    lines.findOrderLineQuantities.mockResolvedValue([]);

    // Distinct from `undefined`: here OL DOES know the line data and knows
    // nothing has arrived.
    await expect(service.reconcile(ORDER_ID, [])).resolves.toEqual({ ordered: 2, delivered: 0 });
  });

  it('should touch no writer when the order has line data but no shipments', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(readyRecord([{ id: 'l1', quantity: 2 }]));

    await service.reconcile(ORDER_ID, []);

    expect(lines.upsertLines).not.toHaveBeenCalled();
    expect(lines.recordActs).not.toHaveBeenCalled();
    expect(lines.foldCounters).not.toHaveBeenCalled();
  });
});
