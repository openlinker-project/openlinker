/**
 * Fulfillment Work Dispatch Handler tests (#2399, `W3a-10`)
 *
 * The handler's own job is the ASSEMBLY and the ADR-007 outcome split — the
 * negotiation itself is core's and is tested beside the service. So what is
 * asserted here is: the ship-to projection carries no buyer identity, a
 * rejection is TERMINAL while every "not yet" condition is RETRYABLE, and the
 * PII flag is read the one way that does not throw on an ordinary deployment.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { FulfillmentWorkUnassignedError } from '@openlinker/core/fulfillment';
import { OrderSnapshotUnavailableError } from '@openlinker/core/orders';

import { FulfillmentWorkDispatchHandler } from '../fulfillment-work-dispatch.handler';

describe('FulfillmentWorkDispatchHandler', () => {
  let handler: FulfillmentWorkDispatchHandler;
  let handshake: { dispatch: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock };
  let orderRecords: { getOrderRecord: jest.Mock };

  const executor = { requestFulfillment: jest.fn(), requestCancellation: jest.fn() };

  const readyRecord = (overrides: Record<string, unknown> = {}) => ({
    internalOrderId: 'ol_order_1',
    recordStatus: 'ready',
    orderSnapshot: {
      id: 'ol_order_1',
      shippingAddress: {
        firstName: 'Anna',
        lastName: 'Kowalska',
        address1: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
        phone: '+48123456789',
      },
      billingAddress: {
        firstName: 'Anna',
        lastName: 'Kowalska',
        address1: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
      ...overrides,
    },
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    delete process.env.OL_STORE_PII;
    // Deliberately UNSET: `getPiiConfig()` throws `PiiConfigurationError` when
    // this is missing regardless of the flag, so leaving it unset is what makes
    // the "reads the flag the safe way" assertion below a real one.
    delete process.env.OL_PII_HASH_SALT;

    handshake = {
      dispatch: jest.fn().mockResolvedValue({
        outcome: 'accepted',
        idempotencyKey: 'work:w1:1',
        assignmentAttempt: 1,
        rejectionReason: null,
        blocking: null,
      }),
    };
    integrations = { getCapabilityAdapter: jest.fn().mockResolvedValue(executor) };
    orderRecords = { getOrderRecord: jest.fn().mockResolvedValue(readyRecord()) };

    handler = new FulfillmentWorkDispatchHandler(
      handshake as never,
      integrations as never,
      orderRecords as never
    );
  });

  const job = (payload: Record<string, unknown>): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'fulfillment.work.dispatch' as unknown as SyncJob['jobType'],
      connectionId: 'conn-1',
      payload,
      idempotencyKey: 'k',
      status: 'queued',
      attempts: 0,
      maxAttempts: 10,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as unknown as SyncJob;

  const validPayload = { workId: 'w1', orderId: 'ol_order_1', expectedAssignmentAttempt: 1 };

  /** The first dispatch input, typed — `jest.Mock.calls` is `any`. */
  const dispatchedWith = (): { shipTo: unknown; expectedAssignmentAttempt: number | null } =>
    (handshake.dispatch.mock.calls as unknown as Array<
      [{ shipTo: unknown; expectedAssignmentAttempt: number | null }]
    >)[0][0];

  it('should project a ship-to carrying no buyer identity, on a deployment with no PII salt', async () => {
    // The regression guarded here is concrete: reading the flag through
    // `getPiiConfig()` throws when `OL_PII_HASH_SALT` is unset — which is every
    // ordinary deployment that never enabled hash-only mode — so dispatch would
    // fail for a reason that has nothing to do with fulfilment.
    const result = await handler.execute(job(validPayload));

    expect(result).toEqual({ outcome: 'ok' });
    const sent = dispatchedWith().shipTo;
    expect(sent).toEqual({
      mode: 'plain',
      countryIso2: 'PL',
      postalCode: '00-001',
      city: 'Warszawa',
    });
    for (const forbidden of ['firstName', 'lastName', 'address1', 'phone', 'name', 'email']) {
      expect(sent).not.toHaveProperty(forbidden);
    }
  });

  it('should degrade to the hashed arm with a null hash, never a fabricated one', async () => {
    process.env.OL_STORE_PII = 'false';

    await handler.execute(job(validPayload));

    // `null` rather than a hash of the already-redacted snapshot address, which
    // would yield ONE hash per country shared by every order in the install.
    expect(dispatchedWith().shipTo).toEqual({
      mode: 'hashed',
      countryIso2: 'PL',
      locationHash: null,
    });
  });

  it('should report a holder rejection as a TERMINAL business_failure', async () => {
    handshake.dispatch.mockResolvedValue({
      outcome: 'rejected',
      idempotencyKey: 'work:w1:1',
      assignmentAttempt: 1,
      rejectionReason: 'no-stock',
      blocking: true,
    });

    // Deterministic business answer, already durable. Retrying would re-cross
    // the executor boundary to be told the same thing.
    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'business_failure' });
  });

  it('should report a no-op as ok, never as a failure', async () => {
    handshake.dispatch.mockResolvedValue({
      outcome: 'no-op',
      idempotencyKey: null,
      assignmentAttempt: null,
      rejectionReason: null,
      blocking: null,
    });

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'ok' });
  });

  it('should treat unassigned work as RETRYABLE, not terminal', async () => {
    handshake.dispatch.mockRejectedValue(new FulfillmentWorkUnassignedError('w1'));

    // This slice does not own the enqueue: a router enqueuing before
    // `assignHolder` commits must not dead-end permanently.
    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should treat an unreadable order snapshot as RETRYABLE', async () => {
    orderRecords.getOrderRecord.mockResolvedValue({
      internalOrderId: 'ol_order_1',
      recordStatus: 'awaiting_mapping',
      orderSnapshot: {},
    });

    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(handshake.dispatch).not.toHaveBeenCalled();
  });

  it('should refuse to dispatch an order with no shipping address', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(readyRecord({ shippingAddress: undefined }));

    // Refusing is the safe direction: an executor handed no destination would
    // either reject, or accept and ship to its own default.
    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(handshake.dispatch).not.toHaveBeenCalled();
  });

  it('should treat an unresolvable executor as RETRYABLE', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));

    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should resolve the executor against the job connection, which is the lane scope', async () => {
    await handler.execute(job(validPayload));

    // Never a synthetic id — #2609's defect is exactly a shared scope
    // collapsing per-scope lane accounting for the whole installation.
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('conn-1', 'FulfillmentExecutor');
  });

  it('should report a malformed payload as terminal without calling anything', async () => {
    expect(await handler.execute(job({ workId: '', orderId: 'o' }))).toEqual({
      outcome: 'business_failure',
    });
    expect(orderRecords.getOrderRecord).not.toHaveBeenCalled();
    expect(handshake.dispatch).not.toHaveBeenCalled();
  });

  it('should carry a null expectedAssignmentAttempt through for a legacy queued job', async () => {
    await handler.execute(job({ workId: 'w1', orderId: 'ol_order_1' }));

    expect(dispatchedWith().expectedAssignmentAttempt).toBeNull();
  });

  it('should surface an unexpected error unchanged rather than mislabelling it', async () => {
    const boom = new OrderSnapshotUnavailableError('ol_order_1', 'unrelated');
    handshake.dispatch.mockRejectedValue(boom);

    await expect(handler.execute(job(validPayload))).rejects.toBe(boom);
  });
});
