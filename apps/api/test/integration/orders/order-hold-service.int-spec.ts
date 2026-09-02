/**
 * Order Hold Service Integration Test (#2339, DESIGN §6.3 / §6.4 / §6.6)
 *
 * Verifies the SERVICE seam against real Postgres — the three things #2338's
 * repository spec cannot cover because they are not properties of a statement:
 * the clock, §6.4's release policy, and the fact that the gate's read
 * (`getOpenHold`) resolves against `order_holds` itself.
 *
 * That last point is what the epic's **L4 exit criterion** rests on: both gates
 * consult `IOrderHoldService.getOpenHold`, and this asserts that the method
 * answers from `order_holds` itself.
 *
 * **The premise of that assertion changed with #2340 and the assertion did
 * not.** It was originally written against a database where
 * `order_records.activeHoldReason` did not exist, so a projection read was
 * impossible by construction; the column now exists, and the guarantee is
 * therefore a design property rather than a structural impossibility — no hold
 * gate may read the cache. `order-hold-projection.int-spec.ts` covers the
 * projection's own behaviour; this file stays the L4 read assertion.
 *
 * **What it does NOT assert** is either gate calling it; that wiring is covered
 * by the two service unit specs (`order-sync.service.spec.ts`,
 * `shipment-dispatch.service.spec.ts`), because standing up a destination
 * adapter and a carrier here would test those adapters rather than the gate. A
 * consumer reading this file should not mistake it for end-to-end proof of L4.
 *
 * The service is resolved by its Symbol token, which is what `OrdersModule`
 * re-exporting `OrderHoldsModule` buys; `apps/**` may not deep-import the class.
 *
 * @module apps/api/test/integration/orders
 */
import {
  HoldReleaseNotPermittedError,
  HoldReleaseNoteRequiredError,
  type IOrderHoldService,
  OrderAlreadyOnHoldError,
  ORDER_HOLD_SERVICE_TOKEN,
} from '@openlinker/core/orders';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

describe('Order Hold Service Integration (#2339)', () => {
  let harness: IntegrationTestHarness;
  let service: IOrderHoldService;

  const ORDER = 'ol_order_hold_service';

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(() => {
    service = harness
      .getApp()
      .get<IOrderHoldService>(ORDER_HOLD_SERVICE_TOKEN, { strict: false });
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should stamp placedAt from OL clock and make the hold readable through the gate seam', async () => {
    const before = Date.now();
    const { hold, fact } = await service.place({
      internalOrderId: ORDER,
      reason: 'stock-shortfall',
      note: 'two units short',
      placedBy: { kind: 'service', service: 'inventory-automation' },
    });
    const after = Date.now();

    expect(hold.placedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(hold.placedAt.getTime()).toBeLessThanOrEqual(after);
    expect(fact).toEqual({
      type: 'held',
      internalOrderId: ORDER,
      reason: 'stock-shortfall',
    });

    // The gate's read — `order_holds`, the authority, not a projection.
    const open = await service.getOpenHold(ORDER);
    expect(open?.id).toBe(hold.id);
    expect(open?.isOpen()).toBe(true);
  });

  it('should refuse a second hold on an order that already has one open', async () => {
    await service.place({
      internalOrderId: ORDER,
      reason: 'operator',
      note: null,
      placedBy: { kind: 'user', userId: 'user-1' },
    });

    await expect(
      service.place({
        internalOrderId: ORDER,
        reason: 'fraud-review',
        note: null,
        placedBy: { kind: 'user', userId: 'user-2' },
      })
    ).rejects.toBeInstanceOf(OrderAlreadyOnHoldError);
  });

  it('should free the gate the moment the hold is released, with no manual repair', async () => {
    const { hold } = await service.place({
      internalOrderId: ORDER,
      reason: 'operator',
      note: null,
      placedBy: { kind: 'user', userId: 'user-1' },
    });

    const { fact } = await service.release({
      holdId: hold.id,
      releasedBy: { kind: 'user', userId: 'user-1' },
    });

    expect(fact.type).toBe('released');
    await expect(service.getOpenHold(ORDER)).resolves.toBeNull();

    // The slot is genuinely free: the partial unique index is partial, so the
    // order can be held again.
    await expect(
      service.place({
        internalOrderId: ORDER,
        reason: 'operator',
        note: null,
        placedBy: { kind: 'user', userId: 'user-1' },
      })
    ).resolves.toBeDefined();
  });

  describe('§6.4 release policy', () => {
    async function placeServiceHold(): Promise<string> {
      const { hold } = await service.place({
        internalOrderId: ORDER,
        reason: 'fraud-review',
        note: null,
        placedBy: { kind: 'service', service: 'fraud-automation' },
      });
      return hold.id;
    }

    it('should require a release note when a user releases a service-placed hold', async () => {
      const holdId = await placeServiceHold();

      await expect(
        service.release({ holdId, releasedBy: { kind: 'user', userId: 'admin-1' } })
      ).rejects.toBeInstanceOf(HoldReleaseNoteRequiredError);

      // The refusal is total: nothing was stamped, so the hold still holds.
      await expect(service.getOpenHold(ORDER)).resolves.not.toBeNull();
    });

    it('should persist the mandatory note when a user overrules a service-placed hold', async () => {
      const holdId = await placeServiceHold();

      const { hold } = await service.release({
        holdId,
        note: 'manually verified with the buyer',
        releasedBy: { kind: 'user', userId: 'admin-1' },
      });

      expect(hold.releaseNote).toBe('manually verified with the buyer');
      expect(hold.releasedByUserId).toBe('admin-1');
      await expect(service.getOpenHold(ORDER)).resolves.toBeNull();
    });

    it('should let the placing service release its own hold with no note', async () => {
      const holdId = await placeServiceHold();

      const { hold } = await service.release({
        holdId,
        releasedBy: { kind: 'service', service: 'fraud-automation' },
      });

      expect(hold.releaseNote).toBeNull();
      expect(hold.releasedByUserId).toBeNull();
    });

    it('should refuse a service releasing a user-placed hold', async () => {
      const { hold } = await service.place({
        internalOrderId: ORDER,
        reason: 'operator',
        note: null,
        placedBy: { kind: 'user', userId: 'user-1' },
      });

      await expect(
        service.release({
          holdId: hold.id,
          releasedBy: { kind: 'service', service: 'inventory-automation' },
        })
      ).rejects.toBeInstanceOf(HoldReleaseNotPermittedError);
    });

    it('should refuse a different service releasing another service-placed hold', async () => {
      const holdId = await placeServiceHold();

      await expect(
        service.release({
          holdId,
          note: 'looks fine',
          releasedBy: { kind: 'service', service: 'inventory-automation' },
        })
      ).rejects.toBeInstanceOf(HoldReleaseNotPermittedError);
      await expect(service.getOpenHold(ORDER)).resolves.not.toBeNull();
    });
  });

  it('should list every hold on the order, newest first', async () => {
    const first = await service.place({
      internalOrderId: ORDER,
      reason: 'operator',
      note: 'one',
      placedBy: { kind: 'user', userId: 'user-1' },
    });
    await service.release({
      holdId: first.hold.id,
      releasedBy: { kind: 'user', userId: 'user-1' },
    });
    const second = await service.place({
      internalOrderId: ORDER,
      reason: 'address-invalid',
      note: 'two',
      placedBy: { kind: 'user', userId: 'user-1' },
    });

    const history = await service.listHolds(ORDER);
    expect(history.map((h) => h.id)).toEqual([second.hold.id, first.hold.id]);
  });
});
