/**
 * Opening one parcel (#2418, spec § 2.4)
 *
 * Stories D2 (a parcel that must not be packed is refused, by the LIST's own
 * rule), D3 (a split order is unambiguous) and D4 (the projection carries
 * nothing an interruption could fire on but unpackability).
 *
 * The end-to-end PII assertion lives in `bench-parcel.int-spec.ts`, over the
 * serialised response — a stronger claim than any of these, and the one that
 * would catch a field added under a nested object. What is proved HERE is the
 * shape of the decisions: which rule the refusal reads, and what the field list
 * is.
 *
 * @module apps/api/src/bench/application/__tests__
 */
import type {
  FulfillmentWorkView,
  IFulfillmentVerificationService,
  IFulfillmentWorklistService,
  ParcelVerificationState,
} from '@openlinker/core/fulfillment';
import type { IOrderRecordService, OrderRecord } from '@openlinker/core/orders';
import type { IProductsService } from '@openlinker/core/products';
import type { IShipmentQueryService } from '@openlinker/core/shipping';

import { BenchExecutorResolver } from '../services/bench-executor.resolver';
import {
  BenchParcelNotAtThisBenchError,
  BenchParcelService,
} from '../services/bench-parcel.service';
import { BENCH_ELIGIBILITY_FIXTURES, expectedRefusalFor } from './bench-eligibility.fixture';

const EXECUTOR_ID = '11111111-1111-1111-1111-111111111111';

const workView = (over: Partial<FulfillmentWorkView> = {}): FulfillmentWorkView =>
  ({
    id: 'work-1',
    orderId: 'ol_order_1',
    locationId: null,
    deliveryMethod: null,
    assignedConnectionId: EXECUTOR_ID,
    status: 'open',
    requestStatus: 'accepted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    expeditedAt: null,
    parcelClosedAt: null,
    packedByUserId: null,
    createdAt: new Date('2026-09-01T09:00:00Z'),
    updatedAt: new Date('2026-09-01T09:00:00Z'),
    lines: [
      {
        id: 'line-1',
        orderLineId: 'ol_line_1',
        productVariantId: 'ol_variant_1',
        totalQuantity: 2,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
      },
    ],
    activeHolds: [],
    supportedActions: [],
    version: 4,
    ...over,
  }) as FulfillmentWorkView;

const state = (over: Partial<ParcelVerificationState> = {}): ParcelVerificationState => ({
  workId: 'work-1',
  // The POST-write token — what a client's next guarded action must carry.
  version: 4,
  lines: [{ workLineId: 'line-1', requiredQuantity: 2, verifiedQuantity: 1 }],
  closedAt: null,
  packedByUserId: null,
  ...over,
});

function harness(options: {
  work?: FulfillmentWorkView;
  siblings?: Map<string, string[]>;
  executorActive?: boolean;
}) {
  const work = options.work ?? workView();

  const executors = new BenchExecutorResolver(
    {
      list: jest.fn().mockResolvedValue([
        {
          id: EXECUTOR_ID,
          name: 'Warehouse packing',
          status: options.executorActive === false ? 'disabled' : 'active',
          platformType: 'openlinker',
          adapterKey: null,
          enabledCapabilities: ['FulfillmentExecutor'],
        },
      ]),
    } as never,
    {
      resolveAdapterMetadata: jest.fn().mockResolvedValue({ adapterKey: 'openlinker.oms.v1' }),
    } as never
  );

  const worklist = {
    get: jest.fn().mockResolvedValue(work),
    listSiblingWorkIds: jest.fn().mockResolvedValue(options.siblings ?? new Map()),
    list: jest.fn(),
    applyAction: jest.fn(),
  } as unknown as IFulfillmentWorklistService;

  const verification = {
    getState: jest.fn().mockResolvedValue(state()),
    verifyUnit: jest.fn(),
    reopenParcel: jest.fn(),
  } as unknown as IFulfillmentVerificationService;

  const orders = {
    findByIds: jest.fn().mockResolvedValue([
      {
        internalOrderId: 'ol_order_1',
        orderSnapshot: {
          orderNumber: 'OL-4471',
          shippingAddress: {
            firstName: 'Anna',
            lastName: 'Nowak',
            address1: 'ul. Testowa 1',
            postcode: '00-001',
          },
          customerEmail: 'anna@example.test',
        },
      } as unknown as OrderRecord,
    ]),
  } as unknown as IOrderRecordService;

  const products = {
    getVariantsByIds: jest
      .fn()
      .mockResolvedValue([
        { id: 'ol_variant_1', productId: 'ol_product_1', sku: 'MUG-WHT-350', ean: '5901234123457', gtin: null },
      ]),
    getProductsByIds: jest
      .fn()
      .mockResolvedValue([{ id: 'ol_product_1', name: 'Ceramic mug, matte white, 350 ml' }]),
  } as unknown as IProductsService;

  const shipments = {
    findByFulfillmentWorkIds: jest.fn().mockResolvedValue(new Map()),
  } as unknown as IShipmentQueryService;

  return {
    service: new BenchParcelService(executors, worklist, verification, orders, products, shipments),
    verification,
  };
}

describe('BenchParcelService (#2418)', () => {
  describe('story D2 — a parcel that must not be packed', () => {
    it('reports a held parcel as refused, with the hold reason', async () => {
      const { service } = harness({
        work: workView({
          activeHolds: [
            { id: 'h1', reason: 'awaiting_stock', note: null, placedAt: new Date() },
          ] as never,
        }),
      });

      const parcel = await service.getParcel('work-1');

      // Heldness comes from the hold ROWS, never from `status` — nothing in the
      // tree writes `status = 'on_hold'`.
      expect(parcel.refusal).toBe('held');
      expect(parcel.holdReason).toBe('awaiting_stock');
    });

    it('reports a cancelled parcel as refused', async () => {
      const { service } = harness({ work: workView({ status: 'cancelled' }) });
      expect((await service.getParcel('work-1')).refusal).toBe('cancelled');
    });

    /**
     * Story G4 — *"the bench and the worklist never disagree"* (#2420, `W3b-7`).
     *
     * The refusal's half of the shared table. `bench-work.service.spec.ts` reads
     * the SAME rows and asserts the colour, so the two surfaces are pinned
     * against one set of cases rather than against each other's current
     * behaviour — a row added to `bench-eligibility.fixture.ts` is asserted on
     * both sides at once.
     *
     * `expectedRefusalFor` is where the correspondence between the two answers
     * is written down, exactly once. Restating it in either spec would let the
     * two drift while both stayed green, which is the failure D2 and G4 both
     * exist to prevent.
     */
    it.each(BENCH_ELIGIBILITY_FIXTURES)(
      'story G4 — $name, read as a refusal',
      async ({ status, requestStatus, activeHoldCount, expected }) => {
        const { service } = harness({
          work: workView({
            status,
            requestStatus,
            // A REAL `HoldReason` (the union is kebab-case), so this array needs
            // no `as never` — the compiler checks the fixture rather than being
            // told to stop looking.
            activeHolds: Array.from({ length: activeHoldCount }, (_unused, index) => ({
              id: `h-${String(index)}`,
              reason: 'address-invalid' as const,
              note: null,
              placedAt: new Date('2026-09-04T09:00:00Z'),
            })),
          }),
        });

        expect((await service.getParcel('work-1')).refusal).toBe(expectedRefusalFor(expected));
      }
    );

    it('records NOTHING when a verification is attempted at a refused parcel', async () => {
      const { service, verification } = harness({ work: workView({ status: 'cancelled' }) });

      const result = await service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g1',
        verifiedByUserId: 'user-1',
      });

      expect(result).toMatchObject({ outcome: 'refused', reason: 'not-packable' });
      expect(verification.verifyUnit).not.toHaveBeenCalled();
    });

    it('refuses a parcel routed to a DIFFERENT executor outright, not as a refusal body', async () => {
      // A packer has no business reading another executor's parcel contents in
      // order to be told they may not pack them — so this is an error the
      // controller answers 404, not a projection with `refusal` set.
      const { service } = harness({
        work: workView({ assignedConnectionId: '99999999-9999-9999-9999-999999999999' }),
      });
      await expect(service.getParcel('work-1')).rejects.toBeInstanceOf(
        BenchParcelNotAtThisBenchError
      );
    });

    it('refuses a work the LIST would not have selected', async () => {
      const { service } = harness({ work: workView({ status: 'closed' }) });
      await expect(service.getParcel('work-1')).rejects.toBeInstanceOf(
        BenchParcelNotAtThisBenchError
      );
    });
  });

  describe('story D3 — a split order is unambiguous', () => {
    it('reports which parcel of the order this is', async () => {
      const { service } = harness({
        siblings: new Map([['ol_order_1', ['work-0', 'work-1']]]),
      });
      const parcel = await service.getParcel('work-1');
      expect(parcel.parcelIndex).toBe(2);
      expect(parcel.parcelTotal).toBe(2);
    });

    it('reads 1 of 1 rather than 1 of 0 when the siblings could not be read', async () => {
      // The work in the packer's hands exists, so the count must include it.
      const { service } = harness({ siblings: new Map() });
      const parcel = await service.getParcel('work-1');
      expect(parcel.parcelIndex).toBe(1);
      expect(parcel.parcelTotal).toBe(1);
    });
  });

  describe('story D4 — the projection an interruption watches', () => {
    it('carries exactly the fields it is supposed to and no others', async () => {
      // This list IS the D4 guarantee: an interruption fires when this
      // projection changes, and nothing here can be moved by a buyer's address
      // edit — so the promise is a property of the field list rather than of a
      // comparison somebody wrote carefully.
      const { service } = harness({});
      const parcel = await service.getParcel('work-1');

      expect(Object.keys(parcel).sort()).toEqual(
        [
          'buyerName',
          'closedAt',
          'holdReason',
          'lines',
          'orderReference',
          'packedByUserId',
          'parcelIndex',
          'parcelTotal',
          'refusal',
          'version',
          'workId',
        ].sort()
      );
      expect(Object.keys(parcel.lines[0]).sort()).toEqual(
        [
          'ean',
          'gtin',
          'name',
          'productVariantId',
          'requiredQuantity',
          'sku',
          'verifiedQuantity',
          'workLineId',
        ].sort()
      );
    });

    it('takes the buyer NAME from the snapshot and nothing else from it', async () => {
      const { service } = harness({});
      const parcel = await service.getParcel('work-1');
      expect(parcel.buyerName).toBe('Anna Nowak');
      expect(parcel.orderReference).toBe('OL-4471');
      expect(JSON.stringify(parcel)).not.toContain('Testowa');
      expect(JSON.stringify(parcel)).not.toContain('anna@example.test');
    });

    it('describes the line from the catalogue so a packer can match the shelf label', async () => {
      const { service } = harness({});
      const line = (await service.getParcel('work-1')).lines[0];
      expect(line).toMatchObject({
        name: 'Ceramic mug, matte white, 350 ml',
        sku: 'MUG-WHT-350',
        ean: '5901234123457',
        requiredQuantity: 2,
        verifiedQuantity: 1,
      });
    });
  });
});
