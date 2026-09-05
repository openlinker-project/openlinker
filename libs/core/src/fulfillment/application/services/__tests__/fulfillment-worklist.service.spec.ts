/**
 * Specs for the worklist read model (#2406).
 *
 * @module libs/core/src/fulfillment/application/services
 */
import { FulfillmentWorkActionNotLegalError } from '../../../domain/exceptions/fulfillment-work-action-not-legal.error';
import { FulfillmentWorkNotFoundError } from '../../../domain/exceptions/fulfillment-work-not-found.error';
import { FulfillmentWorkVersionConflictError } from '../../../domain/exceptions/fulfillment-work-version-conflict.error';
import { FulfillmentWorkVersionMismatchError } from '../../../domain/exceptions/fulfillment-work-version-mismatch.error';
import { MissingFulfillmentWorkActionFieldError } from '../../../domain/exceptions/missing-fulfillment-work-action-field.error';
import { UnsupportedFulfillmentWorkActionError } from '../../../domain/exceptions/unsupported-fulfillment-work-action.error';
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentHold } from '../../../domain/types/fulfillment-hold.types';
import type { FulfillmentWork } from '../../../domain/types/fulfillment-work.types';
import { FulfillmentWorklistService } from '../fulfillment-worklist.service';

const workAt = (over: Partial<FulfillmentWork> = {}): FulfillmentWork => ({
  id: 'work-1',
  orderId: 'ol_order_1',
  locationId: 'loc-1',
  deliveryMethod: 'courier',
  assignedConnectionId: 'conn-1',
  status: 'open',
  requestStatus: 'unsubmitted',
  assignmentAttempt: 0,
  cancellationReason: null,
  version: 7,
  cancelledAt: null,
  dispatchRelayedAt: new Date('2026-08-01T00:00:00Z'),
  expeditedAt: null,
  acceptedAt: null,
  externalWorkId: null,
  parcelClosedAt: null,
  packedByUserId: null,
  packedByService: null,
  lines: [
    {
      id: 'line-1',
      orderLineId: 'ol_line_1',
      productVariantId: 'ol_variant_1',
      totalQuantity: 5,
      fulfilledQuantity: 1,
      cancelledQuantity: 0,
    },
  ],
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-02T00:00:00Z'),
  ...over,
});

const holdAt = (over: Partial<FulfillmentHold> = {}): FulfillmentHold => ({
  id: 'hold-1',
  fulfillmentWorkId: 'work-1',
  reason: 'operator',
  note: 'check address',
  placedByUserId: 'user-1',
  placedByService: 'some-internal-service',
  placedAt: new Date('2026-08-03T00:00:00Z'),
  releasedAt: null,
  releasedByUserId: null,
  releaseNote: null,
  ...over,
});

const makeRepo = (over: Partial<FulfillmentWorkRepositoryPort> = {}) => {
  const repo = {
    findById: jest.fn().mockResolvedValue(workAt()),
    listWorks: jest.fn().mockResolvedValue({ works: [workAt()], total: 1 }),
    listActiveHolds: jest.fn().mockResolvedValue([]),
    listActiveHoldsForWorks: jest.fn().mockResolvedValue(new Map()),
    transitionStatus: jest.fn().mockResolvedValue(true),
    cancel: jest.fn().mockResolvedValue(true),
    placeHold: jest.fn().mockResolvedValue(holdAt()),
    releaseHold: jest.fn().mockResolvedValue(holdAt({ releasedAt: new Date() })),
    ...over,
  } as unknown as jest.Mocked<FulfillmentWorkRepositoryPort>;
  return repo;
};

const makeService = (repo: FulfillmentWorkRepositoryPort): FulfillmentWorklistService =>
  new FulfillmentWorklistService(repo);

describe('FulfillmentWorklistService', () => {
  describe('supportedActions exposure', () => {
    it('should never expose submit even when the derivation finds it legal', async () => {
      // The work is assigned and unsubmitted, so `submit` IS legal — but
      // executing it needs a resolved executor (#2409), so this surface must not
      // offer a control it would refuse.
      const repo = makeRepo();
      const view = await makeService(repo).get('work-1');
      expect(view.supportedActions).not.toContain('submit');
      expect(view.supportedActions).toContain('schedule');
    });

    it('should never expose request_cancellation or any holder reply', async () => {
      const repo = makeRepo({
        findById: jest.fn().mockResolvedValue(workAt({ requestStatus: 'accepted' })),
      } as Partial<FulfillmentWorkRepositoryPort>);
      const view = await makeService(repo).get('work-1');
      for (const excluded of [
        'request_cancellation',
        'accept',
        'reject',
        'accept_cancellation',
        'reject_cancellation',
      ]) {
        expect(view.supportedActions).not.toContain(excluded);
      }
    });

    it('should offer release_hold and suppress forward motion while held', async () => {
      const repo = makeRepo({
        listActiveHolds: jest.fn().mockResolvedValue([holdAt()]),
      } as Partial<FulfillmentWorkRepositoryPort>);
      const view = await makeService(repo).get('work-1');
      expect(view.supportedActions).toContain('release_hold');
      expect(view.supportedActions).not.toContain('schedule');
      expect(view.supportedActions).not.toContain('mark_in_progress');
    });
  });

  describe('projection', () => {
    it('should withhold dispatchRelayedAt and a hold placedByService', async () => {
      const repo = makeRepo({
        listActiveHolds: jest.fn().mockResolvedValue([holdAt()]),
      } as Partial<FulfillmentWorkRepositoryPort>);
      const view = await makeService(repo).get('work-1');

      expect(Object.keys(view)).not.toContain('dispatchRelayedAt');
      expect(Object.keys(view.activeHolds[0])).not.toContain('placedByService');
      expect(Object.keys(view.activeHolds[0])).not.toContain('placedByUserId');
      // Serialising is what actually reaches a browser, so assert on that too.
      expect(JSON.stringify(view)).not.toContain('some-internal-service');
    });

    it('should carry the optimistic token and the line counters', async () => {
      const view = await makeService(makeRepo()).get('work-1');
      expect(view.version).toBe(7);
      expect(view.lines[0].fulfilledQuantity).toBe(1);
      expect(view.lines[0].totalQuantity).toBe(5);
    });

    it('should throw when the work does not exist', async () => {
      const repo = makeRepo({
        findById: jest.fn().mockResolvedValue(null),
      } as Partial<FulfillmentWorkRepositoryPort>);
      await expect(makeService(repo).get('nope')).rejects.toThrow(FulfillmentWorkNotFoundError);
    });
  });

  describe('list', () => {
    it('should batch the holds read once for the page, never per work', async () => {
      const works = [workAt({ id: 'w1' }), workAt({ id: 'w2' }), workAt({ id: 'w3' })];
      const repo = makeRepo({
        listWorks: jest.fn().mockResolvedValue({ works, total: 3 }),
        listActiveHoldsForWorks: jest
          .fn()
          .mockResolvedValue(new Map([['w2', [holdAt({ fulfillmentWorkId: 'w2' })]]])),
      } as Partial<FulfillmentWorkRepositoryPort>);

      const page = await makeService(repo).list({});

      expect(repo.listActiveHoldsForWorks).toHaveBeenCalledTimes(1);
      expect(repo.listActiveHoldsForWorks).toHaveBeenCalledWith(['w1', 'w2', 'w3']);
      // The N+1 this replaces.
      expect(repo.listActiveHolds).not.toHaveBeenCalled();
      expect(page.works[1].supportedActions).toContain('release_hold');
      expect(page.works[0].supportedActions).not.toContain('release_hold');
    });

    it('should report the clamped limit it actually applied, not the one asked for', async () => {
      const page = await makeService(makeRepo()).list({ limit: 5000 });
      expect(page.limit).toBe(100);
    });
  });

  describe('the optimistic token', () => {
    it('should thread expectedVersion into the guarded transition', async () => {
      const repo = makeRepo();
      await makeService(repo).applyAction({
        workId: 'work-1',
        action: 'schedule',
        expectedVersion: 7,
      });
      expect(repo.transitionStatus).toHaveBeenCalledWith(
        expect.objectContaining({ workId: 'work-1', to: 'scheduled', expectedVersion: 7 })
      );
    });

    it('should report a 409-shaped conflict with a REFRESHED action set when the version moved', async () => {
      // The write refused AND the version has moved on: somebody else acted.
      const repo = makeRepo({
        transitionStatus: jest.fn().mockResolvedValue(false),
        findById: jest
          .fn()
          .mockResolvedValueOnce(workAt())
          .mockResolvedValue(workAt({ version: 9, status: 'in_progress' })),
      } as Partial<FulfillmentWorkRepositoryPort>);

      const error = await makeService(repo)
        .applyAction({ workId: 'work-1', action: 'schedule', expectedVersion: 7 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FulfillmentWorkVersionConflictError);
      const conflict = error as FulfillmentWorkVersionConflictError;
      expect(conflict.expectedVersion).toBe(7);
      expect(conflict.currentVersion).toBe(9);
      // Refreshed, not the set the caller acted against.
      expect(conflict.supportedActions).toContain('close');
      expect(conflict.supportedActions).not.toContain('schedule');
    });

    it('should NOT report a stale-token conflict when the version matched and the state refused', async () => {
      // `version` counts state changes, not writes — an idempotent replay sees
      // "not applied" against an UNCHANGED version and must not read as 409-stale.
      const repo = makeRepo({
        transitionStatus: jest.fn().mockResolvedValue(false),
        findById: jest.fn().mockResolvedValue(workAt({ version: 7, status: 'scheduled' })),
      } as Partial<FulfillmentWorkRepositoryPort>);

      const error = await makeService(repo)
        .applyAction({ workId: 'work-1', action: 'schedule', expectedVersion: 7 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FulfillmentWorkActionNotLegalError);
      expect(error).not.toBeInstanceOf(FulfillmentWorkVersionConflictError);
    });

    it('should enrich a hold-path version mismatch into a conflict carrying actions', async () => {
      const repo = makeRepo({
        placeHold: jest
          .fn()
          .mockRejectedValue(new FulfillmentWorkVersionMismatchError('work-1', 7, 11)),
        findById: jest.fn().mockResolvedValue(workAt({ version: 11 })),
      } as Partial<FulfillmentWorkRepositoryPort>);

      const error = await makeService(repo)
        .applyAction({
          workId: 'work-1',
          action: 'hold',
          expectedVersion: 7,
          holdReason: 'operator',
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FulfillmentWorkVersionConflictError);
      expect((error as FulfillmentWorkVersionConflictError).currentVersion).toBe(11);
      expect((error as FulfillmentWorkVersionConflictError).supportedActions.length).toBeGreaterThan(
        0
      );
    });

    it('should thread expectedVersion into both hold writes', async () => {
      const repo = makeRepo();
      const service = makeService(repo);

      await service.applyAction({
        workId: 'work-1',
        action: 'hold',
        expectedVersion: 7,
        holdReason: 'operator',
      });
      expect(repo.placeHold).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7 }));

      await service.applyAction({
        workId: 'work-1',
        action: 'release_hold',
        expectedVersion: 7,
        holdId: 'hold-1',
      });
      expect(repo.releaseHold).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: 7, workId: 'work-1', holdId: 'hold-1' })
      );
    });
  });

  describe('action admission', () => {
    it('should refuse an action this surface does not execute, naming the invocable set', async () => {
      const repo = makeRepo();
      const error = await makeService(repo)
        .applyAction({
          workId: 'work-1',
          // A real vocabulary member, deliberately not exposed here.
          action: 'submit' as never,
          expectedVersion: 7,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnsupportedFulfillmentWorkActionError);
      expect((error as Error).message).toContain('force_cancel');
      // Refused before anything is read or written.
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.transitionStatus).not.toHaveBeenCalled();
    });

    it('should require a reason for hold and a holdId for release_hold', async () => {
      // A MISSING FIELD, not an unsupported action — and the distinction is the
      // point. `UnsupportedFulfillmentWorkActionError` names the invocable set
      // in its message, so raising it here produced copy that denied `hold` was
      // invocable while listing it as invocable. Both are still 400.
      const service = makeService(makeRepo());

      const missingReason = await service
        .applyAction({ workId: 'work-1', action: 'hold', expectedVersion: 7 })
        .catch((e: unknown) => e);
      expect(missingReason).toBeInstanceOf(MissingFulfillmentWorkActionFieldError);
      expect((missingReason as MissingFulfillmentWorkActionFieldError).field).toBe('holdReason');
      expect((missingReason as Error).message).not.toContain('not an operator-invocable');

      const missingHoldId = await service
        .applyAction({ workId: 'work-1', action: 'release_hold', expectedVersion: 7 })
        .catch((e: unknown) => e);
      expect(missingHoldId).toBeInstanceOf(MissingFulfillmentWorkActionFieldError);
      expect((missingHoldId as MissingFulfillmentWorkActionFieldError).field).toBe('holdId');
    });

    it('should force-cancel to cancelled with a reason, never closed-as-completed', async () => {
      const repo = makeRepo();
      await makeService(repo).applyAction({
        workId: 'work-1',
        action: 'force_cancel',
        expectedVersion: 7,
      });
      expect(repo.cancel).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'operator_forced', expectedVersion: 7 })
      );
      expect(repo.transitionStatus).not.toHaveBeenCalled();
    });
  });
});
