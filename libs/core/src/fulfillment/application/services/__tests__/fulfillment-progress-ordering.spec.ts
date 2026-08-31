/**
 * Fulfillment Progress — ordering (#2400, AC3, REVIEW C9)
 *
 * The claim must be committed BEFORE anything is written and before any relay
 * intent is returned. This spec asserts that ordering directly, because it is
 * the property the whole seam exists to provide and prose cannot enforce it.
 *
 * **This is AC3's honest half.** There is no relay caller until #2401, so what
 * is asserted here is "the claim precedes every mutation and every intent",
 * not "the relay is not fired twice" — that second half is #2401's, and the PR
 * says so rather than letting a reader infer coverage that is not there.
 *
 * RED-FIRST EVIDENCE: written first against a variant of the service that
 * called `recordLineProgress` before `claim`. It failed on
 * `expect(calls[0]).toBe('claim')` with `Received: "recordLineProgress"` — the
 * assertion, not a compile error. A `TS6133` red reporting `Tests: 0 total`
 * would have been a false pass.
 */
import type { FulfillmentProgressClaimRepositoryPort } from '../../../domain/ports/fulfillment-progress-claim-repository.port';
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentPickedEvent } from '../../../domain/types/fulfillment-progress-event.types';
import { FulfillmentProgressService } from '../fulfillment-progress.service';

describe('FulfillmentProgressService — claim-before-act ordering', () => {
  let calls: string[];
  let workRepository: jest.Mocked<FulfillmentWorkRepositoryPort>;
  let claimRepository: jest.Mocked<FulfillmentProgressClaimRepositoryPort>;
  let service: FulfillmentProgressService;
  let claimWins: boolean;

  const event: FulfillmentPickedEvent = {
    kind: 'picked',
    workId: 'ol_work_1',
    connectionId: 'conn-1',
    idempotencyKey: 'vendor-key-1',
    occurredAt: new Date('2026-08-31T10:00:00Z'),
    lines: [{ orderLineId: 'line-1', fulfilledDelta: 2, cancelledDelta: 0 }],
  };

  beforeEach(() => {
    calls = [];
    claimWins = true;

    workRepository = {
      findById: jest.fn(() => {
        calls.push('findById');
        return Promise.resolve({ id: 'ol_work_1' } as never);
      }),
      recordLineProgress: jest.fn(() => {
        calls.push('recordLineProgress');
        return Promise.resolve(true);
      }),
      transitionStatus: jest.fn(() => {
        calls.push('transitionStatus');
        return Promise.resolve(true);
      }),
    } as unknown as jest.Mocked<FulfillmentWorkRepositoryPort>;

    claimRepository = {
      claim: jest.fn(() => {
        calls.push('claim');
        return Promise.resolve(claimWins);
      }),
    } as unknown as jest.Mocked<FulfillmentProgressClaimRepositoryPort>;

    service = new FulfillmentProgressService(workRepository, claimRepository);
  });

  it('should claim before any mutation when recording progress', async () => {
    await service.record(event);

    const claimIndex = calls.indexOf('claim');
    const firstMutation = calls.findIndex(
      (c) => c === 'recordLineProgress' || c === 'transitionStatus'
    );

    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(firstMutation).toBeGreaterThanOrEqual(0);
    expect(claimIndex).toBeLessThan(firstMutation);
  });

  it('should read the work before claiming so an unknown id never burns a permanent key', async () => {
    await service.record(event);

    expect(calls.indexOf('findById')).toBeLessThan(calls.indexOf('claim'));
  });

  it('should not claim at all when the work does not exist', async () => {
    workRepository.findById.mockResolvedValue(null);

    const outcome = await service.record(event);

    expect(outcome).toEqual({ status: 'unknown-work', workId: 'ol_work_1' });
    expect(claimRepository.claim).not.toHaveBeenCalled();
  });

  it('should return no intent and write nothing when the claim is lost', async () => {
    claimWins = false;

    const outcome = await service.record(event);

    expect(outcome).toEqual({ status: 'duplicate' });
    expect(workRepository.recordLineProgress).not.toHaveBeenCalled();
    expect(workRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it('should return no relay intent on a duplicate shipped event', async () => {
    claimWins = false;

    const outcome = await service.record({
      kind: 'shipped',
      workId: 'ol_work_1',
      connectionId: 'conn-1',
      idempotencyKey: 'vendor-key-2',
      occurredAt: new Date('2026-08-31T10:00:00Z'),
    });

    // The load-bearing half: a replay must not re-emit the dispatch intent,
    // because #2401 will turn that intent into a real outbound relay.
    expect(outcome).toEqual({ status: 'duplicate' });
    expect(outcome).not.toHaveProperty('intents');
  });
});
