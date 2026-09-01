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
    controller = new FulfillmentWorkController(worklist);
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
});
