/**
 * Assignment-lock guard coverage — every parcel write consults
 * `isClaimableByViewer` (#3435 review)
 *
 * `undoLastScan` shipped with no ADR-074 assignment guard while its two
 * siblings, `verifyUnit` and `reopenParcel`, either already had one or grew
 * one alongside it in this same fix. Both `packer-exclusion.spec.ts` (the
 * ROLE axis — which routes a `packer` may reach at all) and
 * `no-parcel-commit-route.spec.ts` (the ROUTE-SHAPE axis — no route that
 * closes a parcel) already guard this service's surface, and neither says
 * anything about the ASSIGNMENT axis — *which parcel* an admitted packer may
 * act on. That gap is exactly where the missing guard slipped through.
 *
 * ## Inverted, the same way `packer-exclusion.spec.ts` is
 *
 * A hand-picked list of "the mutating methods, as of today" would guard
 * against a regression in the three named here and nothing else. This spec
 * instead reflects `BenchParcelService.prototype`, classifies every method it
 * finds as either a documented private helper, a READ (never mutates
 * verification state, and is governed by story D2's own rule rather than the
 * assignment lock), or a GUARDED MUTATION — and fails if a method shows up in
 * none of the three. A new public write added to this service is therefore a
 * decision someone has to make in this file, not a gap nobody notices until a
 * locked assignment is bypassed a fourth time.
 *
 * ## Why reflection over the CLASS and not the `IBenchParcelService` interface
 *
 * A TypeScript interface has no runtime representation to reflect over — it
 * vanishes at compile time. The class prototype is what actually exists at
 * runtime, so it is walked instead, with TypeScript's `private` methods (which
 * are ordinary enumerable prototype properties in the emitted JS) named
 * explicitly as the one category this spec does not classify further.
 *
 * ## Behavioural, not textual
 *
 * "Calls `isClaimableByViewer`" is not a property `grep` or route metadata can
 * see reliably — a call could be conditional, wrapped, or renamed on import.
 * Each guarded mutation is instead driven against a work LOCKED to someone
 * else, and the assertion is on the OBSERVABLE contract: the call refuses,
 * and the underlying verification-service write is never reached. That is the
 * same shape `bench-parcel.service.spec.ts` already uses for `verifyUnit`'s
 * own assignment tests, generalised to a table so a fourth mutation is proven
 * the same way rather than only described as one.
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
import { BenchParcelService } from '../services/bench-parcel.service';

const EXECUTOR_ID = '11111111-1111-1111-1111-111111111111';

/** A parcel LOCKED to `user-9` — the state every guarded mutation must refuse `user-1` on. */
const lockedWork = (): FulfillmentWorkView =>
  ({
    id: 'work-1',
    orderId: 'ol_order_1',
    locationId: null,
    deliveryMethod: null,
    assignedConnectionId: EXECUTOR_ID,
    assignedToUserId: 'user-9',
    selfServeEligible: false,
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
  }) as FulfillmentWorkView;

const parcelState = (): ParcelVerificationState => ({
  workId: 'work-1',
  version: 4,
  lines: [{ workLineId: 'line-1', requiredQuantity: 2, verifiedQuantity: 1 }],
  closedAt: null,
  packedByUserId: null,
});

function harness() {
  const work = lockedWork();

  const executors = new BenchExecutorResolver(
    {
      list: jest.fn().mockResolvedValue([
        {
          id: EXECUTOR_ID,
          name: 'Warehouse packing',
          status: 'active',
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
    listSiblingWorkIds: jest.fn().mockResolvedValue(new Map()),
    list: jest.fn(),
    applyAction: jest.fn(),
  } as unknown as IFulfillmentWorklistService;

  const verification = {
    getState: jest.fn().mockResolvedValue(parcelState()),
    verifyUnit: jest.fn(),
    reopenParcel: jest.fn(),
    voidLastVerification: jest.fn(),
  } as unknown as IFulfillmentVerificationService;

  const orders = {
    markPacked: jest.fn().mockResolvedValue({} as OrderRecord),
    findByIds: jest.fn().mockResolvedValue([]),
  } as unknown as IOrderRecordService;

  const products = {
    getVariantsByIds: jest.fn().mockResolvedValue([]),
    getProductsByIds: jest.fn().mockResolvedValue([]),
  } as unknown as IProductsService;

  const shipments = {
    findByFulfillmentWorkIds: jest.fn().mockResolvedValue(new Map()),
  } as unknown as IShipmentQueryService;

  return {
    service: new BenchParcelService(executors, worklist, verification, orders, products, shipments),
    verification,
  };
}

/**
 * Every method `BenchParcelService` exposes at runtime, minus the ones this
 * spec is not classifying further.
 *
 * `PRIVATE_HELPERS` are not part of `IBenchParcelService` — they exist only
 * because TypeScript's `private` has no runtime enforcement, so they show up
 * on the prototype exactly like a public method would. Naming them here,
 * rather than filtering on a naming convention, is what keeps a private
 * rename from silently widening or narrowing this spec's coverage.
 */
const PRIVATE_HELPERS = new Set([
  'recordOrderPacked',
  'hasShipped',
  'loadBenchWork',
  'refusalFor',
  'project',
  'describeLines',
]);

/**
 * Reads. Governed by story D2's own rule (`isBenchWorkSelectable`,
 * `loadBenchWork`'s executor check) rather than the assignment lock — a
 * packer excluded from an assignment may still open a locked parcel to see
 * whose it is, exactly as the worklist shows it to them coloured `assigned to
 * a colleague` rather than hiding the row.
 */
const READ_METHODS = new Set(['getParcel', 'getWorkForDocuments']);

/**
 * Mutations. Every one of these MUST refuse a viewer `isClaimableByViewer`
 * excludes, and must never reach its underlying verification-service write.
 */
const GUARDED_MUTATIONS = ['verifyUnit', 'reopenParcel', 'undoLastScan'] as const;

interface GuardedMutationCase {
  readonly method: (typeof GUARDED_MUTATIONS)[number];
  readonly verificationWriteMethod: keyof IFulfillmentVerificationService;
  /** A viewer NOT `user-9`, the id `lockedWork` assigns. Refused either way. */
  readonly callAsExcludedViewer: (
    service: BenchParcelService
  ) => Promise<{ outcome: string; reason: unknown }>;
}

const CASES: readonly GuardedMutationCase[] = [
  {
    method: 'verifyUnit',
    verificationWriteMethod: 'verifyUnit',
    callAsExcludedViewer: (service) =>
      service.verifyUnit({
        workId: 'work-1',
        workLineId: 'line-1',
        gestureId: 'g1',
        verifiedByUserId: 'user-1',
      }),
  },
  {
    method: 'reopenParcel',
    verificationWriteMethod: 'reopenParcel',
    callAsExcludedViewer: (service) =>
      service.reopenParcel({ workId: 'work-1', reopenedByUserId: 'user-1' }),
  },
  {
    method: 'undoLastScan',
    verificationWriteMethod: 'voidLastVerification',
    callAsExcludedViewer: (service) =>
      service.undoLastScan({ workId: 'work-1', actorUserId: 'user-1' }),
  },
];

/**
 * `reopenedByUserId` is the ONE input of the three that is honestly nullable
 * at the type level (`BenchReopenInput`, since its route's `@CurrentUser()`
 * is optional) — `verifyUnit` and `undoLastScan` both require a real actor,
 * so faking a null-ish value for them would test nothing beyond what the
 * excluded-viewer case above already covers.
 */
const NULLABLE_VIEWER_CASE: GuardedMutationCase = {
  method: 'reopenParcel',
  verificationWriteMethod: 'reopenParcel',
  callAsExcludedViewer: (service) =>
    service.reopenParcel({ workId: 'work-1', reopenedByUserId: null }),
};

describe('bench assignment-lock guard coverage (#3435 review)', () => {
  it('classifies every method BenchParcelService exposes as a private helper, a read, or a guarded mutation', () => {
    const proto = BenchParcelService.prototype as unknown as Record<string, unknown>;
    const discovered = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && typeof proto[name] === 'function'
    );

    // Without this, an empty walk would pass every assertion below vacuously.
    expect(discovered.length).toBeGreaterThan(0);

    const classified = new Set([...PRIVATE_HELPERS, ...READ_METHODS, ...GUARDED_MUTATIONS]);
    const unclassified = discovered.filter((name) => !classified.has(name));

    expect(unclassified).toEqual([]);
  });

  it.each(CASES)(
    '$method refuses a viewer isClaimableByViewer excludes, and never reaches its write',
    async ({ verificationWriteMethod, callAsExcludedViewer }) => {
      const { service, verification } = harness();

      const result = await callAsExcludedViewer(service);

      expect(result).toMatchObject({ outcome: 'refused', reason: 'not-packable' });
      expect(verification[verificationWriteMethod]).not.toHaveBeenCalled();
    }
  );

  it('reopenParcel refuses an ANONYMOUS reopen of a locked parcel', async () => {
    const { service, verification } = harness();

    const result = await NULLABLE_VIEWER_CASE.callAsExcludedViewer(service);

    expect(result).toMatchObject({ outcome: 'refused', reason: 'not-packable' });
    expect(verification.reopenParcel).not.toHaveBeenCalled();
  });
});
