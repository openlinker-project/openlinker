/**
 * Specs for the worklist read model (#2406).
 *
 * @module libs/core/src/fulfillment/application/services
 */
import { EmptyFulfillmentWorkAssignmentUpdateError } from '../../../domain/exceptions/empty-fulfillment-work-assignment-update.error';
import { ExclusiveAssignmentRequiresPackerError } from '../../../domain/exceptions/exclusive-assignment-requires-packer.error';
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
  assignedToUserId: null,
  unassignedSince: null,
  selfServeEligible: true,
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
  invoicePrintedAt: null,
  labelPrintedAt: null,
  completedAt: null,
  completedByUserId: null,
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

  describe('updateAssignment (#3337, ADR-074)', () => {
    it('should refuse a patch naming neither field', async () => {
      const service = makeService(makeRepo());

      const error = await service
        .updateAssignment({ workId: 'work-1' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmptyFulfillmentWorkAssignmentUpdateError);
    });

    it('should assign a packer', async () => {
      const repo = makeRepo({
        assignToPacker: jest.fn().mockResolvedValue(true),
      });

      await makeService(repo).updateAssignment({ workId: 'work-1', assignedToUserId: 'user-9' });

      expect(repo.assignToPacker).toHaveBeenCalledWith('work-1', 'user-9', undefined);
    });

    it('should clear an assignment on an explicit null, never on omission', async () => {
      const repo = makeRepo({
        clearAssignment: jest.fn().mockResolvedValue(true),
        assignToPacker: jest.fn().mockResolvedValue(true),
      });

      await makeService(repo).updateAssignment({ workId: 'work-1', assignedToUserId: null });

      expect(repo.clearAssignment).toHaveBeenCalledWith('work-1', undefined);
      expect(repo.assignToPacker).not.toHaveBeenCalled();
    });

    it('should set self-serve eligibility independently of the assignment axis', async () => {
      const assignToPacker = jest.fn().mockResolvedValue(true);
      const repo = makeRepo({
        setSelfServeEligible: jest.fn().mockResolvedValue(true),
        assignToPacker,
        // ADR-074 / #3360: an ASSIGNED parcel, because exclusivity now needs a
        // packer to be exclusive to. The property under test is unchanged —
        // the two axes are written independently, one call each.
        findById: jest.fn().mockResolvedValue(workAt({ assignedToUserId: 'user-9' })),
      });

      await makeService(repo).updateAssignment({ workId: 'work-1', selfServeEligible: false });

      expect(repo.setSelfServeEligible).toHaveBeenCalledWith('work-1', false, undefined);
      expect(assignToPacker).not.toHaveBeenCalled();
    });

    // ADR-074 / #3360 — the refusal, in its own case rather than folded into
    // the one above. It matters because the repository's guard answers the
    // same `false` every benign no-op on this axis answers, so without the
    // named error the supervisor gets a 200 and a toggle that silently snapped
    // back.
    it('should refuse exclusivity on a parcel with no assigned packer', async () => {
      const repo = makeRepo({
        setSelfServeEligible: jest.fn().mockResolvedValue(false),
        findById: jest.fn().mockResolvedValue(workAt({ assignedToUserId: null })),
      });

      await expect(
        makeService(repo).updateAssignment({ workId: 'work-1', selfServeEligible: false })
      ).rejects.toThrow(ExclusiveAssignmentRequiresPackerError);
    });

    // The opposite direction is NOT refused: `true` restores the column
    // default and is the state `clearAssignment` itself writes, so refusing it
    // on an unassigned row would refuse a no-op.
    it('should allow restoring self-serve on a parcel with no assigned packer', async () => {
      const repo = makeRepo({
        setSelfServeEligible: jest.fn().mockResolvedValue(true),
        findById: jest.fn().mockResolvedValue(workAt({ assignedToUserId: null })),
      });

      await expect(
        makeService(repo).updateAssignment({ workId: 'work-1', selfServeEligible: true })
      ).resolves.toBeDefined();
    });

    it('should apply both axes in one call when both are supplied', async () => {
      const repo = makeRepo({
        assignToPacker: jest.fn().mockResolvedValue(true),
        setSelfServeEligible: jest.fn().mockResolvedValue(true),
        // The re-read must show the assignee the first write just made — a
        // fixture that still reads unassigned would contradict the call under
        // test and trip #3360's check on a sequence that is entirely legal.
        findById: jest.fn().mockResolvedValue(workAt({ assignedToUserId: 'user-9' })),
      });

      await makeService(repo).updateAssignment({
        workId: 'work-1',
        assignedToUserId: 'user-9',
        selfServeEligible: false,
      });

      expect(repo.assignToPacker).toHaveBeenCalledWith('work-1', 'user-9', undefined);
      expect(repo.setSelfServeEligible).toHaveBeenCalledWith('work-1', false, undefined);
    });

    it('threads the bumped version forward when both axes are supplied with an expectedVersion', async () => {
      // #3340 second follow-up: the SECOND write must be guarded against the
      // version the FIRST write's own bump produces, never the caller's
      // original token — or a legitimate two-field PATCH would fail its own
      // second half every single time.
      const repo = makeRepo({
        assignToPacker: jest.fn().mockResolvedValue(true),
        setSelfServeEligible: jest.fn().mockResolvedValue(true),
        // The row this call's own first write produced (#3360) — the case is
        // about version arithmetic, so its fixture must not contradict it.
        findById: jest.fn().mockResolvedValue(workAt({ assignedToUserId: 'user-9' })),
      });

      await makeService(repo).updateAssignment({
        workId: 'work-1',
        assignedToUserId: 'user-9',
        selfServeEligible: false,
        expectedVersion: 4,
      });

      expect(repo.assignToPacker).toHaveBeenCalledWith('work-1', 'user-9', 4);
      expect(repo.setSelfServeEligible).toHaveBeenCalledWith('work-1', false, 5);
    });

    it('does not advance the threaded version when the first write did not apply', async () => {
      // If the first write lost the race, the second must be guarded against
      // the CALLER's original token, not a bump that never happened.
      const repo = makeRepo({
        assignToPacker: jest.fn().mockResolvedValue(false),
        setSelfServeEligible: jest.fn().mockResolvedValue(true),
        // Assigned to SOMEBODY ELSE: the premise is that this call's
        // `assignToPacker` lost the race, so a re-read returns what the winner
        // wrote, not an unassigned row (#3360).
        findById: jest.fn().mockResolvedValue(
          workAt({ version: 4, assignedToUserId: 'user-other' })
        ),
      });

      await makeService(repo).updateAssignment({
        workId: 'work-1',
        assignedToUserId: 'user-9',
        selfServeEligible: false,
        expectedVersion: 4,
      });

      expect(repo.setSelfServeEligible).toHaveBeenCalledWith('work-1', false, 4);
    });

    it('raises a version conflict when a guarded write did not apply and the version genuinely differs', async () => {
      const repo = makeRepo({
        assignToPacker: jest.fn().mockResolvedValue(false),
        findById: jest.fn().mockResolvedValue(workAt({ version: 7 })),
      });

      const error = await makeService(repo)
        .updateAssignment({ workId: 'work-1', assignedToUserId: 'user-9', expectedVersion: 4 })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(FulfillmentWorkVersionConflictError);
    });

    it('does NOT raise a conflict for the ordinary no-op the write already tolerated', async () => {
      // clearAssignment on an already-unassigned row: the version matches
      // exactly what the caller supplied, so the guard's own STATE
      // precondition (not a lost update) is what refused.
      const repo = makeRepo({
        clearAssignment: jest.fn().mockResolvedValue(false),
        findById: jest.fn().mockResolvedValue(workAt({ version: 4 })),
      });

      await expect(
        makeService(repo).updateAssignment({
          workId: 'work-1',
          assignedToUserId: null,
          expectedVersion: 4,
        })
      ).resolves.toBeDefined();
    });

    it('leaves expectedVersion untouched (never called with it) when the caller omits it', async () => {
      const repo = makeRepo({
        assignToPacker: jest.fn().mockResolvedValue(true),
      });

      await makeService(repo).updateAssignment({ workId: 'work-1', assignedToUserId: 'user-9' });

      expect(repo.assignToPacker).toHaveBeenCalledWith('work-1', 'user-9', undefined);
    });

    it('raises not-found when the work object is gone, regardless of which write "failed"', async () => {
      const repo = makeRepo({
        assignToPacker: jest.fn().mockResolvedValue(false),
        findById: jest.fn().mockResolvedValue(null),
      });

      const error = await makeService(repo)
        .updateAssignment({ workId: 'ghost', assignedToUserId: 'user-9' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FulfillmentWorkNotFoundError);
    });

    it('should return the fresh view, re-read after the write', async () => {
      const repo = makeRepo({
        assignToPacker: jest.fn().mockResolvedValue(true),
        findById: jest
          .fn()
          .mockResolvedValue(workAt({ assignedToUserId: 'user-9', selfServeEligible: true })),
      });

      const view = await makeService(repo).updateAssignment({
        workId: 'work-1',
        assignedToUserId: 'user-9',
      });

      expect(view.assignedToUserId).toBe('user-9');
    });
  });
});
