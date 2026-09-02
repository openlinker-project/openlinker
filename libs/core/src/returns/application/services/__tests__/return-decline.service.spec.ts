/**
 * Return Decline Service Tests (#2333, ADR-060 / ADR-044)
 *
 * Covers the seven branches the action can take, plus the three properties the
 * issue's acceptance criteria name: the proposal is written BEFORE the adapter
 * call, `declinedAt` is stamped only from an observed confirmation, and a
 * double-call is a no-op.
 *
 * @module libs/core/src/returns/application/services/__tests__
 */
import type { IOrderChangeService, OrderChange } from '@openlinker/core/orders';
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import { ReturnDeclineUnsupportedError } from '../../../domain/exceptions/return-decline-unsupported.error';
import { ReturnNotAttributedError } from '../../../domain/exceptions/return-not-attributed.error';
import { ReturnNotFoundError } from '../../../domain/exceptions/return-not-found.error';
import { ReturnDeclineRejectedBySourceError } from '../../../domain/exceptions/return-decline-rejected-by-source.error';
import { ReturnDeclineInvalidRequestError } from '../../../domain/exceptions/return-decline-invalid-request.error';
import type { ReturnRepositoryPort } from '../../../domain/ports/return-repository.port';
import { ReturnDeclineService } from '../return-decline.service';
import { ReturnsService } from '../returns.service';

const RETURN_ID = 'ol_return_1';
const ORDER_ID = 'ol_order_1';
const CONNECTION_ID = 'conn-1';
const DECLINED_AT = new Date('2026-08-25T09:00:00.000Z');

function buildReturn(
  overrides: {
    internalOrderId?: string | null;
    externalReturnId?: string | null;
    declinedAt?: Date | null;
  } = {}
): ReturnRecord {
  return new ReturnRecord(
    RETURN_ID,
    CONNECTION_ID,
    overrides.externalReturnId === undefined ? 'ext-return-1' : overrides.externalReturnId,
    overrides.internalOrderId === undefined ? ORDER_ID : overrides.internalOrderId,
    'ext-order-1',
    'source_ingested',
    'DELIVERED',
    null,
    null,
    null,
    overrides.declinedAt ?? null,
    null,
    new Date(),
    new Date(),
    []
  );
}

function buildChange(id = 'change-1'): OrderChange {
  return { id, kind: 'return.decline' } as OrderChange;
}

describe('ReturnDeclineService', () => {
  let repository: jest.Mocked<Pick<ReturnRepositoryPort, 'findById' | 'claimDeclinedAt'>>;
  let orderChanges: jest.Mocked<IOrderChangeService>;
  let integrations: { getCapabilityAdapter: jest.Mock };
  let declineReturn: jest.Mock;
  let service: ReturnDeclineService;

  const input = {
    returnId: RETURN_ID,
    reasonCode: 'REFUND_REJECTED',
    comment: 'Item is damaged',
    requestedBy: 'user-1',
  };

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      claimDeclinedAt: jest.fn().mockResolvedValue(true),
    };
    orderChanges = {
      openOrReuse: jest
        .fn()
        .mockResolvedValue({ change: buildChange(), opened: true, expiredStale: false }),
      confirm: jest.fn().mockResolvedValue(true),
      decline: jest.fn().mockResolvedValue(true),
      abandon: jest.fn().mockResolvedValue(true),
      claimApplied: jest.fn().mockResolvedValue(true),
      findLatestByTarget: jest.fn().mockResolvedValue(null),
    };
    declineReturn = jest.fn();
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({
        listReturnFeed: jest.fn(),
        getReturn: jest.fn(),
        declineReturn,
      }),
    };

    // The REAL guard, not a stub. `ReturnDeclineService` asserts attribution
    // through `IReturnsService.assertAttributedForTrigger('decline')` (#2332), so
    // wiring the real service is what keeps this spec honest about which class the
    // refusal actually is — a hand-rolled stub could throw a look-alike forever.
    // `identifierMapping` is never reached on the guard path.
    const returns = new ReturnsService(
      repository as unknown as ReturnRepositoryPort,
      { getInternalId: jest.fn() } as never,
      // #2334's metadata-only integrations seam. Never reached on the guard
      // path this spec drives.
      { getAdapter: jest.fn(), listCapabilityAdapters: jest.fn() } as never
    );

    service = new ReturnDeclineService(
      repository as unknown as ReturnRepositoryPort,
      returns,
      orderChanges,
      integrations as never
    );
  });

  it('should throw ReturnNotFoundError when the return does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.decline(input)).rejects.toBeInstanceOf(ReturnNotFoundError);
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should refuse an orphan return before resolving any adapter', async () => {
    repository.findById.mockResolvedValue(buildReturn({ internalOrderId: null }));

    await expect(service.decline(input)).rejects.toBeInstanceOf(ReturnNotAttributedError);
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
  });

  it('should refuse with a distinct reason when the source declares no decline support', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    integrations.getCapabilityAdapter.mockResolvedValue({
      listReturnFeed: jest.fn(),
      getReturn: jest.fn(),
    });

    await expect(service.decline(input)).rejects.toBeInstanceOf(
      ReturnDeclineUnsupportedError
    );
    expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
  });

  it('should refuse as unsupported when the connection has no OrderSource adapter', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('no adapter'));

    await expect(service.decline(input)).rejects.toBeInstanceOf(
      ReturnDeclineUnsupportedError
    );
  });

  it('should refuse as unsupported when the return carries no source-native id', async () => {
    repository.findById.mockResolvedValue(buildReturn({ externalReturnId: null }));

    await expect(service.decline(input)).rejects.toBeInstanceOf(
      ReturnDeclineUnsupportedError
    );
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should be a no-op when the return is already declined', async () => {
    repository.findById.mockResolvedValue(buildReturn({ declinedAt: DECLINED_AT }));
    orderChanges.findLatestByTarget.mockResolvedValue(buildChange('change-old'));

    const result = await service.decline(input);

    expect(result.outcome).toBe('already-declined');
    expect(result.declinedAt).toEqual(DECLINED_AT);
    expect(result.changeId).toBe('change-old');
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(declineReturn).not.toHaveBeenCalled();
  });

  it('should not send a second request when an open proposal already holds the target', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    orderChanges.openOrReuse.mockResolvedValue({
      change: buildChange('change-open'),
      opened: false,
      expiredStale: false,
    });

    const result = await service.decline(input);

    expect(result.outcome).toBe('in-flight');
    expect(declineReturn).not.toHaveBeenCalled();
  });

  it('should persist the proposal before calling the adapter', async () => {
    const order: string[] = [];
    repository.findById.mockResolvedValue(buildReturn());
    orderChanges.openOrReuse.mockImplementation(() => {
      order.push('proposal');
      return Promise.resolve({
        change: buildChange(),
        opened: true,
        expiredStale: false,
      });
    });
    declineReturn.mockImplementation(() => {
      order.push('adapter');
      return Promise.resolve({ declinedAt: DECLINED_AT, rawStatus: 'REJECTED' });
    });

    await service.decline(input);

    expect(order).toEqual(['proposal', 'adapter']);
  });

  it('should stamp declinedAt from the source-reported instant and apply once', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    declineReturn.mockResolvedValue({ declinedAt: DECLINED_AT, rawStatus: 'REJECTED' });

    const result = await service.decline(input);

    expect(result.outcome).toBe('declined');
    expect(result.declinedAt).toEqual(DECLINED_AT);
    expect(orderChanges.confirm).toHaveBeenCalledWith(
      'change-1',
      `source:${CONNECTION_ID}`
    );
    expect(repository.claimDeclinedAt).toHaveBeenCalledWith(RETURN_ID, DECLINED_AT);
  });

  it('should not stamp declinedAt when the source reports no instant', async () => {
    // "a 2xx alone never displays as declined by {source}" — there is no
    // fallback to OL's clock anywhere on this path.
    repository.findById.mockResolvedValue(buildReturn());
    declineReturn.mockResolvedValue({ declinedAt: null, rawStatus: 'CREATED' });

    const result = await service.decline(input);

    expect(result.outcome).toBe('decline-sent');
    expect(result.declinedAt).toBeNull();
    expect(orderChanges.confirm).toHaveBeenCalled();
    expect(orderChanges.claimApplied).not.toHaveBeenCalled();
    expect(repository.claimDeclinedAt).not.toHaveBeenCalled();
  });

  it('should not re-stamp declinedAt when the apply claim was lost', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    declineReturn.mockResolvedValue({ declinedAt: DECLINED_AT, rawStatus: 'REJECTED' });
    orderChanges.claimApplied.mockResolvedValue(false);

    await service.decline(input);

    expect(repository.claimDeclinedAt).not.toHaveBeenCalled();
  });

  it('should record a source refusal as a declined change rather than throwing', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    declineReturn.mockRejectedValue(
      new ReturnDeclineRejectedBySourceError('ext-return-1', 'Return already settled')
    );

    const result = await service.decline(input);

    expect(result.outcome).toBe('refused');
    expect(result.refusalReason).toBe('Return already settled');
    expect(orderChanges.decline).toHaveBeenCalledWith('change-1', 'Return already settled');
    expect(repository.claimDeclinedAt).not.toHaveBeenCalled();
  });

  it('should abandon the proposal and rethrow when OL own pre-flight refuses the request', async () => {
    // A LOCAL validation fault is not the authority's refusal: nothing was
    // sent, so `declinedReason` — the authority's words — must stay untouched
    // and the proposal is expired rather than declined, freeing the slot for
    // the corrected retry (Wave-1c review, finding 7).
    repository.findById.mockResolvedValue(buildReturn());
    declineReturn.mockRejectedValue(
      new ReturnDeclineInvalidRequestError('ext-return-1', 'reasonCode', 'not a known code')
    );

    await expect(service.decline(input)).rejects.toBeInstanceOf(
      ReturnDeclineInvalidRequestError
    );

    expect(orderChanges.abandon).toHaveBeenCalledWith('change-1');
    expect(orderChanges.decline).not.toHaveBeenCalled();
    expect(orderChanges.confirm).not.toHaveBeenCalled();
    expect(repository.claimDeclinedAt).not.toHaveBeenCalled();
  });

  it('should leave the proposal open and rethrow when the call fails in doubt', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    declineReturn.mockRejectedValue(new Error('socket hang up'));

    await expect(service.decline(input)).rejects.toThrow('socket hang up');
    expect(orderChanges.decline).not.toHaveBeenCalled();
    expect(orderChanges.confirm).not.toHaveBeenCalled();
    expect(repository.claimDeclinedAt).not.toHaveBeenCalled();
  });
});
