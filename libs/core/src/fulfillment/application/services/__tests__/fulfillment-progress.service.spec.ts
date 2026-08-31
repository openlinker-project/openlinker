/**
 * Fulfillment Progress Service Unit Tests (#2400)
 *
 * One test per event kind, plus the three non-`recorded` outcomes.
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import type { FulfillmentProgressClaimRepositoryPort } from '../../../domain/ports/fulfillment-progress-claim-repository.port';
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentProgressEvent } from '../../../domain/types/fulfillment-progress-event.types';
import { FulfillmentProgressService } from '../fulfillment-progress.service';

describe('FulfillmentProgressService', () => {
  let workRepository: jest.Mocked<FulfillmentWorkRepositoryPort>;
  let claimRepository: jest.Mocked<FulfillmentProgressClaimRepositoryPort>;
  let service: FulfillmentProgressService;

  const base = {
    workId: 'ol_work_1',
    connectionId: 'conn-1',
    idempotencyKey: 'vendor-key-1',
    occurredAt: new Date('2026-08-31T10:00:00Z'),
  };

  beforeEach(() => {
    workRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'ol_work_1' }),
      recordLineProgress: jest.fn().mockResolvedValue(true),
      transitionStatus: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<FulfillmentWorkRepositoryPort>;

    claimRepository = {
      claim: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<FulfillmentProgressClaimRepositoryPort>;

    service = new FulfillmentProgressService(workRepository, claimRepository);
  });

  it('should move the counters and no intent when a picked event is recorded', async () => {
    const outcome = await service.record({
      ...base,
      kind: 'picked',
      lines: [{ orderLineId: 'line-1', fulfilledDelta: 2, cancelledDelta: 0 }],
    });

    expect(outcome).toEqual({ status: 'recorded', intents: [] });
    expect(workRepository.recordLineProgress).toHaveBeenCalledWith({
      workId: 'ol_work_1',
      orderLineId: 'line-1',
      fulfilledDelta: 2,
      cancelledDelta: 0,
    });
  });

  it('should close the work incomplete and report a reroute intent when short picked', async () => {
    const outcome = await service.record({
      ...base,
      kind: 'short_picked',
      lines: [{ orderLineId: 'line-1', fulfilledDelta: 1, cancelledDelta: 2 }],
    });

    expect(outcome).toEqual({
      status: 'recorded',
      intents: [{ kind: 'reroute', workId: 'ol_work_1', blockedHolderId: 'conn-1' }],
    });
    expect(workRepository.transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ workId: 'ol_work_1', to: 'incomplete' })
    );
  });

  it('should REPORT the reroute rather than perform it, since re-entry needs the orders context', async () => {
    // ADR-053: performing this means importing `@openlinker/core/orders`, which
    // both guards forbid under this directory. #2401 composes the intent.
    const outcome = await service.record({
      ...base,
      kind: 'short_picked',
      lines: [{ orderLineId: 'line-1', fulfilledDelta: 0, cancelledDelta: 3 }],
    });

    expect(outcome.status).toBe('recorded');
    // No router, no order read — the service has neither dependency to call.
    expect(Object.keys(service)).not.toContain('router');
  });

  it('should report a dispatch intent when shipped', async () => {
    const outcome = await service.record({ ...base, kind: 'shipped' });

    expect(outcome).toEqual({
      status: 'recorded',
      intents: [{ kind: 'dispatch', workId: 'ol_work_1' }],
    });
  });

  it('should move the execution axis when packed', async () => {
    const outcome = await service.record({ ...base, kind: 'packed' });

    expect(outcome).toEqual({ status: 'recorded', intents: [] });
    expect(workRepository.transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'in_progress' })
    );
  });

  it('should close the work when closed', async () => {
    const outcome = await service.record({ ...base, kind: 'closed' });

    expect(outcome).toEqual({ status: 'recorded', intents: [] });
    expect(workRepository.transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'closed' })
    );
  });

  it('should return unknown-work and call no mutator when the work does not exist', async () => {
    workRepository.findById.mockResolvedValue(null);

    const outcome = await service.record({ ...base, kind: 'shipped' });

    expect(outcome).toEqual({ status: 'unknown-work', workId: 'ol_work_1' });
    expect(workRepository.transitionStatus).not.toHaveBeenCalled();
    expect(claimRepository.claim).not.toHaveBeenCalled();
  });

  it('should return precondition-failed rather than throw when a guarded line update is refused', async () => {
    // `false` is the guarded-update convention for "the precondition no longer
    // held and nothing was written" — an ordinary outcome, never an error.
    workRepository.recordLineProgress.mockResolvedValue(false);

    const outcome = await service.record({
      ...base,
      kind: 'picked',
      lines: [{ orderLineId: 'line-1', fulfilledDelta: 99, cancelledDelta: 0 }],
    });

    expect(outcome.status).toBe('precondition-failed');
    expect((outcome as { reason: string }).reason).toContain('line-1');
  });

  it('should return precondition-failed rather than throw when a terminal work cannot be closed', async () => {
    workRepository.transitionStatus.mockResolvedValue(false);

    const outcome = await service.record({ ...base, kind: 'closed' });

    expect(outcome.status).toBe('precondition-failed');
  });

  it('should not lift an operator hold when a picked event arrives', async () => {
    // `on_hold` is absent from the `picked` transition's `from` set on purpose:
    // a hold is a deliberate suspension, and letting an executor's report
    // silently lift it would make the hold advisory.
    await service.record({
      ...base,
      kind: 'picked',
      lines: [{ orderLineId: 'line-1', fulfilledDelta: 1, cancelledDelta: 0 }],
    });

    const call = workRepository.transitionStatus.mock.calls[0][0];
    expect(call.from).not.toContain('on_hold');
  });

  it('should stamp the claim with the event kind and connection for forensics', async () => {
    const event: FulfillmentProgressEvent = { ...base, kind: 'shipped' };

    await service.record(event);

    expect(claimRepository.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        workId: 'ol_work_1',
        idempotencyKey: 'vendor-key-1',
        connectionId: 'conn-1',
        eventKind: 'shipped',
      })
    );
  });
});
