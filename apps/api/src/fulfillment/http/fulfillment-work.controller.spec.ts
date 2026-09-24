/**
 * Fulfillment Work Controller — unit specs (#2406, `W3a-19`)
 *
 * The controller carries three pieces of its own behaviour, and each one is a
 * fact a consumer (#2410 / #2411) depends on:
 *
 *  1. `:action` is validated against the SAME constant the read model filters
 *     `supportedActions` with, so an action offered can never be an action
 *     rejected.
 *  2. Every domain error reachable from an exposed action is mapped. Anything
 *     unmapped becomes a 500, so the mapping is the contract.
 *  3. The two 409s carry a stable `code` discriminator — one is retryable and
 *     the other is not, and a client must not infer which from field presence.
 *
 * @module apps/api/src/fulfillment/http
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import {
  FulfillmentHoldAlreadyReleasedError,
  FulfillmentHoldLimitExceededError,
  FulfillmentHoldNotFoundError,
  FulfillmentWorkActionNotLegalError,
  FulfillmentWorkNotFoundError,
  FulfillmentWorkVersionConflictError,
  MissingFulfillmentWorkActionFieldError,
  OPERATOR_INVOCABLE_ACTIONS,
  UnsupportedFulfillmentWorkActionError,
  type FulfillmentWorkView,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';

import type { AuthenticatedUser } from '../../auth/auth.types';
import { FulfillmentWorkController } from './fulfillment-work.controller';
import type { ApplyFulfillmentWorkActionDto } from './dto/apply-fulfillment-work-action.dto';

const view = (overrides: Partial<FulfillmentWorkView> = {}): FulfillmentWorkView =>
  ({
    id: 'work-1',
    orderId: 'ol_order_1',
    locationId: 'loc-1',
    deliveryMethod: 'courier',
    assignedConnectionId: null,
    status: 'open',
    requestStatus: 'unsubmitted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-08-31T00:00:00Z'),
    updatedAt: new Date('2026-08-31T00:00:00Z'),
    lines: [],
    activeHolds: [],
    supportedActions: ['schedule', 'hold'],
    version: 3,
    ...overrides,
  }) as FulfillmentWorkView;

const user: AuthenticatedUser = { id: 'user-1', username: 'op', role: 'operator' };

/**
 * The three collaborator reads this controller composes (#3425 / #3426).
 *
 * Built fresh per test rather than shared, because the batching assertions
 * below are about CALL COUNTS — a shared mock would accumulate them across
 * tests and the constant-query-count proof would silently stop proving
 * anything.
 */
/**
 * One batched read: takes the page's ids, answers the rows it found.
 *
 * Typed rather than a bare `jest.fn()` so `mock.calls[0][0]` is a
 * `readonly string[]` — the constant-query-count proof below asserts on the
 * ids each read was given, and an `any` there would let that assertion pass
 * against anything at all.
 */
type BatchedRead = jest.Mock<Promise<Record<string, unknown>[]>, [readonly string[]]>;

const batchedRead = (): BatchedRead =>
  jest
    .fn<Promise<Record<string, unknown>[]>, [readonly string[]]>()
    .mockResolvedValue([]);

const collaborators = (): {
  orders: { findByIds: BatchedRead };
  locations: { getLocationsByIds: BatchedRead };
  products: { getVariantsByIds: BatchedRead; getProductsByIds: BatchedRead };
} => ({
  orders: { findByIds: batchedRead() },
  locations: { getLocationsByIds: batchedRead() },
  products: { getVariantsByIds: batchedRead(), getProductsByIds: batchedRead() },
});

type Collaborators = ReturnType<typeof collaborators>;

const build = (
  worklist: jest.Mocked<IFulfillmentWorklistService>,
  deps: Collaborators = collaborators()
): Collaborators & { controller: FulfillmentWorkController } => ({
  controller: new FulfillmentWorkController(
    worklist,
    deps.orders as never,
    deps.locations as never,
    deps.products as never
  ),
  ...deps,
});

const body = (overrides: Partial<ApplyFulfillmentWorkActionDto> = {}) =>
  ({ expectedVersion: 3, ...overrides }) as ApplyFulfillmentWorkActionDto;

describe('FulfillmentWorkController', () => {
  let worklist: jest.Mocked<IFulfillmentWorklistService>;
  let controller: FulfillmentWorkController;

  beforeEach(() => {
    worklist = {
      list: jest.fn(),
      get: jest.fn(),
      applyAction: jest.fn(),
    } as unknown as jest.Mocked<IFulfillmentWorklistService>;
    controller = build(worklist).controller;
  });

  describe('applyAction', () => {
    it('should refuse an action outside the invocable set with a 400 naming that set', async () => {
      const error = await controller
        .applyAction('work-1', 'submit', body(), user)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('submit');
      // The refusal names what IS invocable, so a caller can correct itself.
      expect((error as Error).message).toContain('schedule');
      expect(worklist.applyAction).not.toHaveBeenCalled();
    });

    it.each([...OPERATOR_INVOCABLE_ACTIONS])(
      'should accept the invocable action %s that the read model also offers',
      async (action) => {
        worklist.applyAction.mockResolvedValue(view());

        await controller.applyAction('work-1', action, body(), user);

        expect(worklist.applyAction).toHaveBeenCalledWith(
          expect.objectContaining({ workId: 'work-1', action, expectedVersion: 3 })
        );
      }
    );

    it('should thread the authenticated user as the audit actor', async () => {
      // `placeHold` persists this as `placedByUserId`. Dropping it writes a null
      // actor on every hold taken through the operator UI.
      worklist.applyAction.mockResolvedValue(view());

      await controller.applyAction('work-1', 'hold', body({ holdReason: 'operator' }), user);

      expect(worklist.applyAction).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'user-1' })
      );
    });
  });

  describe('the 409 discriminator', () => {
    it('should answer a stale token with code=version_conflict and the refreshed set', async () => {
      worklist.applyAction.mockRejectedValue(
        new FulfillmentWorkVersionConflictError('work-1', 3, 7, ['release_hold'])
      );

      const error = (await controller
        .applyAction('work-1', 'hold', body(), user)
        .catch((e: unknown) => e)) as ConflictException;

      expect(error).toBeInstanceOf(ConflictException);
      const payload = error.getResponse() as Record<string, unknown>;
      expect(payload.code).toBe('version_conflict');
      expect(payload.currentVersion).toBe(7);
      expect(payload.supportedActions).toEqual(['release_hold']);
    });

    it('should answer an illegal-but-current action with code=action_not_legal', async () => {
      worklist.applyAction.mockRejectedValue(
        new FulfillmentWorkActionNotLegalError('work-1', 'close', ['schedule'])
      );

      const error = (await controller
        .applyAction('work-1', 'close', body(), user)
        .catch((e: unknown) => e)) as ConflictException;

      const payload = error.getResponse() as Record<string, unknown>;
      expect(payload.code).toBe('action_not_legal');
      expect(payload.action).toBe('close');
      // No version fields — but a client keys on `code`, never on their absence.
      expect(payload.supportedActions).toEqual(['schedule']);
    });

    it('should give the two 409s DIFFERENT codes', async () => {
      // The whole point: same status, different retryability. If these ever
      // collapse to one value a consumer silently starts retrying a refusal
      // that can never succeed.
      worklist.applyAction.mockRejectedValueOnce(
        new FulfillmentWorkVersionConflictError('work-1', 3, 7, [])
      );
      const stale = (await controller
        .applyAction('work-1', 'hold', body(), user)
        .catch((e: unknown) => e)) as ConflictException;

      worklist.applyAction.mockRejectedValueOnce(
        new FulfillmentWorkActionNotLegalError('work-1', 'close', [])
      );
      const illegal = (await controller
        .applyAction('work-1', 'close', body(), user)
        .catch((e: unknown) => e)) as ConflictException;

      const codeOf = (e: ConflictException): unknown =>
        (e.getResponse() as Record<string, unknown>).code;
      expect(codeOf(stale)).not.toBe(codeOf(illegal));
    });
  });

  describe('domain-error mapping', () => {
    it.each([
      ['work not found', new FulfillmentWorkNotFoundError('work-1'), NotFoundException],
      ['hold not found', new FulfillmentHoldNotFoundError('hold-1'), NotFoundException],
      [
        'hold limit exceeded',
        new FulfillmentHoldLimitExceededError('work-1', 10, 10),
        ConflictException,
      ],
      [
        'hold already released',
        new FulfillmentHoldAlreadyReleasedError('hold-1', new Date()),
        ConflictException,
      ],
      [
        'unsupported action',
        new UnsupportedFulfillmentWorkActionError('nope', ['schedule']),
        BadRequestException,
      ],
    ])('should map %s to its own HTTP status', async (_label, thrown, expected) => {
      // Anything unmapped surfaces as a 500, so each reachable error is pinned.
      worklist.applyAction.mockRejectedValue(thrown);

      const error = await controller
        .applyAction('work-1', 'hold', body(), user)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(expected);
    });

    it('should not deny that an invocable action is invocable when a field is missing', async () => {
      // The defect this pins was operator-facing COPY, so the assertion is about
      // the message. Reusing UnsupportedFulfillmentWorkActionError produced
      // "'hold (without a reason)' is not an operator-invocable ... action;
      // invocable: schedule, hold, ..." — denying `hold` while listing it, which
      // sends a client looking for a capability problem it does not have.
      worklist.applyAction.mockRejectedValue(
        new MissingFulfillmentWorkActionFieldError('hold', 'holdReason')
      );

      const error = (await controller
        .applyAction('work-1', 'hold', body(), user)
        .catch((e: unknown) => e)) as BadRequestException;

      expect(error).toBeInstanceOf(BadRequestException);
      const message = error.message;
      expect(message).toContain('holdReason');
      expect(message).not.toContain('not an operator-invocable');
    });

    it('should map a not-found on the single read too', async () => {
      worklist.get.mockRejectedValue(new FulfillmentWorkNotFoundError('missing'));

      const error = await controller.get('missing').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
    });
  });

  describe('projection', () => {
    it('should carry supportedActions and the token out to the client', async () => {
      worklist.get.mockResolvedValue(view({ supportedActions: ['schedule'], version: 11 }));

      const dto = await controller.get('work-1');

      expect(dto.supportedActions).toEqual(['schedule']);
      expect(dto.version).toBe(11);
    });

    it('should report the applied limit and offset from the page, not the request', async () => {
      worklist.list.mockResolvedValue({ works: [view()], total: 1, limit: 100, offset: 0 });

      const page = await controller.list({ limit: 9999 } as never);

      expect(page.limit).toBe(100);
      expect(page.total).toBe(1);
    });
  });

  describe('#3425 — masked buyer name, dispatch deadline, carrier', () => {
    it('masks the buyer name to a first initial and surname, never the full name', async () => {
      worklist.get.mockResolvedValue(view());
      const { controller: c, orders } = build(worklist);
      orders.findByIds.mockResolvedValue([
        {
          internalOrderId: 'ol_order_1',
          dispatchByAt: new Date('2026-09-04T15:00:00Z'),
          orderSnapshot: { shippingAddress: { firstName: 'Anna', lastName: 'Kowalska' } },
        },
      ]);

      const dto = await c.get('work-1');

      expect(dto.buyerNameMasked).toBe('A. Kowalska');
      expect(dto.dispatchByAt).toBe('2026-09-04T15:00:00.000Z');
      expect(JSON.stringify(dto)).not.toContain('Anna');
    });

    it('reports null rather than a placeholder when the order cannot be read', async () => {
      worklist.get.mockResolvedValue(view());

      const dto = await controller.get('work-1');

      expect(dto.buyerNameMasked).toBeNull();
      expect(dto.dispatchByAt).toBeNull();
      expect(dto.carrierName).toBeNull();
    });

    it('batches ONE order read for a whole page, never one per row', async () => {
      worklist.list.mockResolvedValue({
        works: [view({ id: 'w-1', orderId: 'ol_order_1' }), view({ id: 'w-2', orderId: 'ol_order_1' })],
        total: 2,
        limit: 100,
        offset: 0,
      });
      const { controller: c, orders } = build(worklist);

      await c.list({} as never);

      expect(orders.findByIds).toHaveBeenCalledTimes(1);
      expect(orders.findByIds).toHaveBeenCalledWith(['ol_order_1']);
    });
  });

  describe('#3426 — order reference, location name, product name', () => {
    const line = (id: string, variantId: string): FulfillmentWorkView['lines'][number] =>
      ({
        id,
        orderLineId: `line-${id}`,
        productVariantId: variantId,
        totalQuantity: 1,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
      }) as FulfillmentWorkView['lines'][number];

    it("carries the source's own order reference, the location name and the product name", async () => {
      // The whole point of the change: the mockup's lane card leads with
      // "OL-4471", not with ol_order_0aaeb3c4….
      worklist.get.mockResolvedValue(
        view({ locationId: 'ol_location_1', lines: [line('l-1', 'ol_variant_1')] })
      );
      const { controller: c, orders, locations, products } = build(worklist);
      orders.findByIds.mockResolvedValue([
        { internalOrderId: 'ol_order_1', orderSnapshot: { orderNumber: 'OL-4471' } },
      ]);
      locations.getLocationsByIds.mockResolvedValue([
        { id: 'ol_location_1', name: 'Main warehouse' },
      ]);
      products.getVariantsByIds.mockResolvedValue([
        { id: 'ol_variant_1', productId: 'ol_product_1' },
      ]);
      products.getProductsByIds.mockResolvedValue([{ id: 'ol_product_1', name: 'Ceramic mug' }]);

      const dto = await c.get('work-1');

      expect(dto.orderReference).toBe('OL-4471');
      expect(dto.locationName).toBe('Main warehouse');
      expect(dto.lines[0].productName).toBe('Ceramic mug');
      // The ids stay on the row — the names are ADDITIVE, never a replacement.
      expect(dto.orderId).toBe('ol_order_1');
      expect(dto.locationId).toBe('ol_location_1');
      expect(dto.lines[0].productVariantId).toBe('ol_variant_1');
    });

    it('answers null — never the internal id — when the order is not in order_records', async () => {
      // A work holds orderId by value with no FK, so it can outlive or precede
      // its order record. `null` says "OpenLinker cannot see this order", which
      // a supervisor can act on; ol_order_… dressed as a reference cannot.
      worklist.get.mockResolvedValue(view());

      const dto = await controller.get('work-1');

      expect(dto.orderReference).toBeNull();
      expect(dto.orderReference).not.toBe('ol_order_1');
    });

    it('answers null for a location that is gone, and for a work that has none', async () => {
      worklist.list.mockResolvedValue({
        works: [
          view({ id: 'w-1', locationId: 'ol_location_gone' }),
          // ADR-058 decision 2 — the master declines to locate its stock.
          view({ id: 'w-2', locationId: null }),
        ],
        total: 2,
        limit: 100,
        offset: 0,
      });
      const { controller: c, locations } = build(worklist);
      locations.getLocationsByIds.mockResolvedValue([]);

      const page = await c.list({} as never);

      expect(page.works[0].locationName).toBeNull();
      expect(page.works[1].locationName).toBeNull();
      // A null locationId is never asked about — that is not a lookup miss.
      expect(locations.getLocationsByIds).toHaveBeenCalledWith(['ol_location_gone']);
    });

    it('answers null for a variant absent from the catalogue, never a placeholder', async () => {
      worklist.get.mockResolvedValue(view({ lines: [line('l-1', 'ol_variant_gone')] }));
      const { controller: c } = build(worklist);

      const dto = await c.get('work-1');

      expect(dto.lines[0].productName).toBeNull();
    });

    it('resolves a page of N works in a CONSTANT number of reads, not N', async () => {
      // THE regression this guards. Every field added here is a cross-context
      // join, and the obvious implementation of each is one read per row. The
      // assertion is on the counts, so an N+1 reintroduced later fails here
      // rather than on a production page of 50.
      const N = 50;
      const works = Array.from({ length: N }, (_, i) =>
        view({
          id: `w-${i}`,
          // Distinct ids throughout, so nothing passes by accidental de-duping.
          orderId: `ol_order_${i}`,
          locationId: `ol_location_${i}`,
          lines: [line(`l-${i}a`, `ol_variant_${i}a`), line(`l-${i}b`, `ol_variant_${i}b`)],
        })
      );
      worklist.list.mockResolvedValue({ works, total: N, limit: 100, offset: 0 });
      const { controller: c, orders, locations, products } = build(worklist);
      products.getVariantsByIds.mockResolvedValue(
        works.flatMap((w) =>
          w.lines.map((l) => ({ id: l.productVariantId, productId: `ol_product_${l.id}` }))
        )
      );

      const page = await c.list({} as never);

      expect(page.works).toHaveLength(N);
      expect(orders.findByIds).toHaveBeenCalledTimes(1);
      expect(locations.getLocationsByIds).toHaveBeenCalledTimes(1);
      expect(products.getVariantsByIds).toHaveBeenCalledTimes(1);
      expect(products.getProductsByIds).toHaveBeenCalledTimes(1);

      // …and each of those four carries the WHOLE page's ids, which is what
      // makes "called once" mean batched rather than merely truncated.
      expect(orders.findByIds.mock.calls[0][0]).toHaveLength(N);
      expect(locations.getLocationsByIds.mock.calls[0][0]).toHaveLength(N);
      expect(products.getVariantsByIds.mock.calls[0][0]).toHaveLength(N * 2);
      expect(products.getProductsByIds.mock.calls[0][0]).toHaveLength(N * 2);
    });

    it('asks about each distinct id ONCE when a page repeats one', async () => {
      // A page routinely names one location many times over; the parameter
      // list should be bounded by the distinct ids, not by the page size.
      worklist.list.mockResolvedValue({
        works: [
          view({ id: 'w-1', orderId: 'ol_order_1', locationId: 'ol_location_1' }),
          view({ id: 'w-2', orderId: 'ol_order_1', locationId: 'ol_location_1' }),
        ],
        total: 2,
        limit: 100,
        offset: 0,
      });
      const { controller: c, orders, locations } = build(worklist);

      await c.list({} as never);

      expect(orders.findByIds).toHaveBeenCalledWith(['ol_order_1']);
      expect(locations.getLocationsByIds).toHaveBeenCalledWith(['ol_location_1']);
    });

    it('issues no read at all for an empty page', async () => {
      worklist.list.mockResolvedValue({ works: [], total: 0, limit: 100, offset: 0 });
      const { controller: c, orders, locations, products } = build(worklist);

      await c.list({} as never);

      expect(orders.findByIds).not.toHaveBeenCalled();
      expect(locations.getLocationsByIds).not.toHaveBeenCalled();
      expect(products.getVariantsByIds).not.toHaveBeenCalled();
      expect(products.getProductsByIds).not.toHaveBeenCalled();
    });
  });
});
