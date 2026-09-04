/**
 * Fulfilment Handshake Service — unit specs (#2399, `W3a-10`)
 *
 * The properties here are the ones REVIEW C7 turns on. The headline is test 1:
 * a job retry must re-mint the IDENTICAL idempotency key, because a re-minted
 * key is a second fulfilment request to a 3PL — a double-ship.
 *
 * No Nest testing module: the executor and the ship-to are ARGUMENTS (ADR-053),
 * so the only collaborator to fake is the repository port.
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import { FulfillmentWorkNotFoundError } from '../../../domain/exceptions/fulfillment-work-not-found.error';
import { FulfillmentWorkUnassignedError } from '../../../domain/exceptions/fulfillment-work-unassigned.error';
import type { FulfillmentExecutorPort } from '../../../domain/ports/fulfillment-executor.port';
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentRequestResult } from '../../../domain/types/fulfillment-execution.types';
import type { FulfillmentWork } from '../../../domain/types/fulfillment-work.types';
import type { RoutingShipTo } from '../../../domain/types/routing-ship-to.types';
import { FulfillmentHandshakeService } from '../fulfillment-handshake.service';

const CONNECTION_ID = '11111111-1111-1111-1111-111111111111';

const SHIP_TO: RoutingShipTo = {
  mode: 'plain',
  countryIso2: 'PL',
  postalCode: '00-001',
  city: 'Warszawa',
};

const buildWork = (overrides: Partial<FulfillmentWork> = {}): FulfillmentWork => ({
  id: 'ol_fulfillmentwork_abc',
  orderId: 'ol_order_1',
  locationId: 'loc-1',
  deliveryMethod: 'courier',
  assignedConnectionId: CONNECTION_ID,
  status: 'open',
  requestStatus: 'unsubmitted',
  assignmentAttempt: 0,
  cancellationReason: null,
  version: 0,
  cancelledAt: null,
  dispatchRelayedAt: null,
  expeditedAt: null,
  acceptedAt: null,
  externalWorkId: null,
  parcelClosedAt: null,
  packedByUserId: null,
  packedByService: null,
  lines: [
    {
      id: 'line-1',
      orderLineId: 'ol-1',
      productVariantId: 'ol_variant_1',
      totalQuantity: 2,
      fulfilledQuantity: 0,
      cancelledQuantity: 0,
    },
  ],
  createdAt: new Date('2026-08-30T00:00:00Z'),
  updatedAt: new Date('2026-08-30T00:00:00Z'),
  ...overrides,
});

interface Harness {
  service: FulfillmentHandshakeService;
  repository: jest.Mocked<FulfillmentWorkRepositoryPort>;
  executor: jest.Mocked<FulfillmentExecutorPort>;
}

const buildHarness = (options: {
  works: FulfillmentWork[];
  claim?: number | null;
  result?: FulfillmentRequestResult;
}): Harness => {
  const queue = [...options.works];
  const repository = {
    create: jest.fn(),
    // Successive reads return successive states, so the RE-READ after a failed
    // claim genuinely observes what a peer left behind rather than the row the
    // service already had.
    findById: jest.fn().mockImplementation(() => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve(next ?? null);
    }),
    findByOrderId: jest.fn(),
    transitionStatus: jest.fn(),
    transitionRequestStatus: jest.fn().mockResolvedValue(true),
    assignHolder: jest.fn(),
    clearHolder: jest.fn(),
    claimDispatchAttempt: jest.fn().mockResolvedValue(options.claim ?? null),
    recordAcceptance: jest.fn().mockResolvedValue(true),
    recordRejection: jest.fn().mockResolvedValue(true),
    listBlockingRejections: jest.fn().mockResolvedValue([]),
    claimDispatchRelay: jest.fn(),
    cancel: jest.fn(),
    recordLineProgress: jest.fn(),
    placeHold: jest.fn(),
    releaseHold: jest.fn(),
    listActiveHolds: jest.fn(),
  } as unknown as jest.Mocked<FulfillmentWorkRepositoryPort>;

  const executor = {
    requestFulfillment: jest
      .fn()
      .mockResolvedValue(
        options.result ?? { status: 'accepted', externalWorkId: 'ext-1', acceptedAt: null }
      ),
    requestCancellation: jest
      .fn()
      .mockResolvedValue({ status: 'accepted', externalWorkId: null, acceptedAt: null }),
  } as unknown as jest.Mocked<FulfillmentExecutorPort>;

  return { service: new FulfillmentHandshakeService(repository), repository, executor };
};

describe('FulfillmentHandshakeService', () => {
  describe('dispatch — idempotency key stability (REVIEW C7)', () => {
    it('should re-mint an IDENTICAL key when a job retry resumes a claimed attempt', async () => {
      // First run: claims attempt 1 and calls.
      const first = buildHarness({ works: [buildWork()], claim: 1 });
      const firstResult = await first.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: null,
        shipTo: SHIP_TO,
        executor: first.executor,
      });

      // Retry: the claim no longer applies (the row is `submitted`), so the
      // service must RESUME the persisted attempt rather than take a new one.
      const retry = buildHarness({
        works: [buildWork({ requestStatus: 'submitted', assignmentAttempt: 1 })],
        claim: null,
      });
      const retryResult = await retry.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: 1,
        shipTo: SHIP_TO,
        executor: retry.executor,
      });

      expect(firstResult.idempotencyKey).toBe('work:ol_fulfillmentwork_abc:1');
      // THE assertion this whole slice exists for.
      expect(retryResult.idempotencyKey).toBe(firstResult.idempotencyKey);
      expect(retry.repository.claimDispatchAttempt).toHaveBeenCalledTimes(1);
    });

    it('should persist the attempt BEFORE calling the executor', async () => {
      const harness = buildHarness({ works: [buildWork()], claim: 1 });
      const order: string[] = [];
      harness.repository.claimDispatchAttempt.mockImplementation(() => {
        order.push('claim');
        return Promise.resolve(1);
      });
      harness.executor.requestFulfillment.mockImplementation(() => {
        order.push('request');
        return Promise.resolve({ status: 'accepted', externalWorkId: null, acceptedAt: null });
      });

      await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: null,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      // The counter is written by the statement that returns it, so this
      // ordering is structural rather than a convention a caller must keep.
      expect(order).toEqual(['claim', 'request']);
    });

    it('should claim only from unsubmitted or rejected, never from a terminal state', async () => {
      const harness = buildHarness({ works: [buildWork()], claim: 1 });
      await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: null,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      const claimedFrom = harness.repository.claimDispatchAttempt.mock.calls[0][0]
        .from;
      expect([...claimedFrom].sort()).toEqual(['rejected', 'unsubmitted']);
    });
  });

  describe('dispatch — states that must send nothing', () => {
    it('should never re-offer work a holder has already accepted', async () => {
      const harness = buildHarness({
        works: [buildWork({ requestStatus: 'accepted', assignmentAttempt: 1 })],
        claim: null,
      });

      const result = await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: 1,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      expect(result.outcome).toBe('no-op');
      expect(result.idempotencyKey).toBeNull();
      expect(harness.executor.requestFulfillment).not.toHaveBeenCalled();
    });

    it('should send nothing while a cancellation is in flight on the other axis', async () => {
      // `cancellation_requested` is IN-FLIGHT, not terminal. Re-offering here
      // would put two live requests to one holder.
      const harness = buildHarness({
        works: [buildWork({ requestStatus: 'cancellation_requested', assignmentAttempt: 1 })],
        claim: null,
      });

      const result = await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: 1,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      expect(result.outcome).toBe('no-op');
      expect(harness.executor.requestFulfillment).not.toHaveBeenCalled();
    });

    it('should offer a RESUMED dispatch to the holder the row names NOW', async () => {
    // A peer may `clearHolder` + `assignHolder` while the work is `submitted` —
    // nothing forbids it — so the row loaded before the claim can name a holder
    // that no longer holds the work. Sending to it would offer the work to the
    // wrong connection under a key the current holder has never seen, and the
    // port's replay guarantee cannot rescue that: it is scoped to one holder.
    const OTHER_HOLDER = '99999999-9999-9999-9999-999999999999';
    const { service, executor } = buildHarness({
      works: [
        buildWork({ requestStatus: 'submitted', assignmentAttempt: 1 }),
        buildWork({
          requestStatus: 'submitted',
          assignmentAttempt: 1,
          assignedConnectionId: OTHER_HOLDER,
        }),
      ],
      claim: null,
    });

    const result = await service.dispatch({
      workId: 'ol_fulfillmentwork_abc',
      expectedAssignmentAttempt: 1,
      shipTo: SHIP_TO,
      executor,
    });

    expect(result.outcome).toBe('accepted');
    const sent = executor.requestFulfillment.mock.calls[0][0];
    expect(sent.work.connectionId).toBe(OTHER_HOLDER);
    // The key is still the attempt's, unchanged by the holder move.
    expect(sent.idempotencyKey).toBe('work:ol_fulfillmentwork_abc:1');
  });

  it('should refuse to resume an attempt this job was not enqueued for', async () => {
      // A delayed duplicate for attempt 1, waking after a re-request moved the
      // work to attempt 2. Sending would mint a key it never claimed.
      const harness = buildHarness({
        works: [buildWork({ requestStatus: 'submitted', assignmentAttempt: 2 })],
        claim: null,
      });

      const result = await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: 1,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      expect(result.outcome).toBe('no-op');
      expect(harness.executor.requestFulfillment).not.toHaveBeenCalled();
    });

    it('should throw a RETRYABLE error when the work has no holder', async () => {
      const harness = buildHarness({
        works: [buildWork({ assignedConnectionId: null })],
        claim: 1,
      });

      await expect(
        harness.service.dispatch({
          workId: 'ol_fulfillmentwork_abc',
          expectedAssignmentAttempt: null,
          shipTo: SHIP_TO,
          executor: harness.executor,
        })
      ).rejects.toBeInstanceOf(FulfillmentWorkUnassignedError);
      // Nothing was claimed: an unassigned work must not consume an attempt.
      expect(harness.repository.claimDispatchAttempt).not.toHaveBeenCalled();
    });

    it('should throw when the work does not exist', async () => {
      const harness = buildHarness({ works: [], claim: null });
      harness.repository.findById.mockResolvedValue(null);

      await expect(
        harness.service.dispatch({
          workId: 'missing',
          expectedAssignmentAttempt: null,
          shipTo: SHIP_TO,
          executor: harness.executor,
        })
      ).rejects.toBeInstanceOf(FulfillmentWorkNotFoundError);
    });
  });

  describe('dispatch — recording the answer', () => {
    it('should stamp acceptance from the result, carrying the holder instant verbatim', async () => {
      const acceptedAt = new Date('2026-08-30T10:00:00Z');
      const harness = buildHarness({
        works: [buildWork()],
        claim: 1,
        result: { status: 'accepted', externalWorkId: 'ext-9', acceptedAt },
      });

      const result = await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: null,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      expect(result.outcome).toBe('accepted');
      expect(harness.repository.recordAcceptance).toHaveBeenCalledWith({
        workId: 'ol_fulfillmentwork_abc',
        acceptedAt,
        externalWorkId: 'ext-9',
      });
    });

    it('should record a blocking rejection with the rejecter connection', async () => {
      const harness = buildHarness({
        works: [buildWork()],
        claim: 1,
        result: { status: 'rejected', reason: 'no-capacity', blocking: true, detail: 'full' },
      });

      const result = await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: null,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      expect(result.outcome).toBe('rejected');
      expect(result.blocking).toBe(true);
      expect(harness.repository.recordRejection).toHaveBeenCalledWith(
        expect.objectContaining({
          workId: 'ol_fulfillmentwork_abc',
          orderId: 'ol_order_1',
          // Without this the row excludes nobody.
          connectionId: CONNECTION_ID,
          assignmentAttempt: 1,
          reason: 'no-capacity',
          blocking: true,
          detail: 'full',
        })
      );
    });

    it('should report a lost stamp race as a no-op rather than calling again', async () => {
      const harness = buildHarness({ works: [buildWork()], claim: 1 });
      harness.repository.recordAcceptance.mockResolvedValue(false);

      const result = await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: null,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      expect(result.outcome).toBe('no-op');
      expect(harness.executor.requestFulfillment).toHaveBeenCalledTimes(1);
    });

    it('should send the work-row delivery method, never a caller-supplied one', async () => {
      const harness = buildHarness({
        works: [buildWork({ deliveryMethod: 'locker' })],
        claim: 1,
      });

      await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: null,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      expect(harness.executor.requestFulfillment).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryMethod: 'locker' })
      );
    });

    it('should project lines through the allowlist and carry no buyer identity', async () => {
      const harness = buildHarness({ works: [buildWork()], claim: 1 });

      await harness.service.dispatch({
        workId: 'ol_fulfillmentwork_abc',
        expectedAssignmentAttempt: null,
        shipTo: SHIP_TO,
        executor: harness.executor,
      });

      const request = harness.executor.requestFulfillment.mock.calls[0][0];
      expect(request.lines).toEqual([
        { workLineId: 'line-1', productVariantId: 'ol_variant_1', quantity: 2 },
      ]);
      for (const forbidden of ['name', 'email', 'phone', 'address', 'order']) {
        expect(request).not.toHaveProperty(forbidden);
      }
    });
  });

  describe('requestCancellation', () => {
    it('should use a key that can NEVER collide with the dispatch key', async () => {
      const harness = buildHarness({
        works: [buildWork({ requestStatus: 'accepted', assignmentAttempt: 3 })],
      });

      const result = await harness.service.requestCancellation({
        workId: 'ol_fulfillmentwork_abc',
        reason: 'operator_forced',
        executor: harness.executor,
      });

      // Sharing the dispatch key would have the executor answer the
      // cancellation with the dispatch's cached `accepted`, so OL would record
      // `cancellation_accepted` for a cancellation the holder never saw.
      expect(result.idempotencyKey).toBe('work:ol_fulfillmentwork_abc:3:cancel');
      expect(result.idempotencyKey).not.toBe('work:ol_fulfillmentwork_abc:3');
    });

    it('should record a refused cancellation as cancellation_rejected', async () => {
      const harness = buildHarness({
        works: [buildWork({ requestStatus: 'accepted', assignmentAttempt: 1 })],
      });
      harness.executor.requestCancellation.mockResolvedValue({
        status: 'rejected',
        reason: 'already-picked',
        blocking: false,
        detail: null,
      });

      const result = await harness.service.requestCancellation({
        workId: 'ol_fulfillmentwork_abc',
        reason: 'operator_forced',
        executor: harness.executor,
      });

      expect(result.outcome).toBe('cancellation-rejected');
      expect(harness.repository.transitionRequestStatus).toHaveBeenLastCalledWith({
        workId: 'ol_fulfillmentwork_abc',
        from: ['cancellation_requested'],
        to: 'cancellation_rejected',
      });
    });

    it('should send nothing for work no holder has accepted', async () => {
      const harness = buildHarness({
        works: [buildWork({ requestStatus: 'submitted' })],
      });

      const result = await harness.service.requestCancellation({
        workId: 'ol_fulfillmentwork_abc',
        reason: 'operator_forced',
        executor: harness.executor,
      });

      expect(result.outcome).toBe('no-op');
      expect(harness.executor.requestCancellation).not.toHaveBeenCalled();
    });
  });
});
