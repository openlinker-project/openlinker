/**
 * Return Authorize Service Tests (#2372, ADR-060 / ADR-044)
 *
 * Covers the branches the action can take, plus the acceptance criteria the issue
 * names: `authorize` is refused on a `source_ingested` return with an explaining
 * error, and the act is recorded against the ADR-044 `order_changes` table rather
 * than a second proposal mechanism.
 *
 * @module libs/core/src/returns/application/services/__tests__
 */
import type { IOrderChangeService, OrderChange } from '@openlinker/core/orders';
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import { ReturnAuthorizeRefusedError } from '../../../domain/exceptions/return-authorize-refused.error';
import { ReturnNotAttributedError } from '../../../domain/exceptions/return-not-attributed.error';
import { ReturnNotFoundError } from '../../../domain/exceptions/return-not-found.error';
import type { ReturnRepositoryPort } from '../../../domain/ports/return-repository.port';
import type { ReturnOrigin } from '../../../domain/types/return.types';
import { ReturnAuthorizeService } from '../return-authorize.service';
import { ReturnsService } from '../returns.service';

const RETURN_ID = 'ol_return_auth';
const ORDER_ID = 'ol_order_auth';
const CONNECTION_ID = 'conn-auth';
const ALREADY_AT = new Date('2026-08-20T10:00:00.000Z');

function buildReturn(
  overrides: {
    origin?: ReturnOrigin;
    internalOrderId?: string | null;
    authorizedAt?: Date | null;
  } = {}
): ReturnRecord {
  return new ReturnRecord(
    RETURN_ID,
    CONNECTION_ID,
    null,
    overrides.internalOrderId === undefined ? ORDER_ID : overrides.internalOrderId,
    null,
    overrides.origin ?? 'operator_authored',
    null,
    null,
    new Date(),
    overrides.authorizedAt ?? null,
    null,
    null,
    new Date(),
    new Date(),
    []
  );
}

function buildChange(id = 'change-auth-1'): OrderChange {
  return { id, kind: 'return.authorize' } as OrderChange;
}

describe('ReturnAuthorizeService', () => {
  let repository: jest.Mocked<Pick<ReturnRepositoryPort, 'findById' | 'claimAuthorizedAt'>>;
  let orderChanges: jest.Mocked<IOrderChangeService>;
  let service: ReturnAuthorizeService;

  const input = { returnId: RETURN_ID, actorUserId: 'user-1' };

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      claimAuthorizedAt: jest.fn().mockResolvedValue(true),
    };

    orderChanges = {
      openOrReuse: jest
        .fn()
        .mockResolvedValue({ change: buildChange(), opened: true, expiredStale: false }),
      confirm: jest.fn().mockResolvedValue(true),
      decline: jest.fn(),
      abandon: jest.fn(),
      claimApplied: jest.fn().mockResolvedValue(true),
      findLatestByTarget: jest.fn().mockResolvedValue(null),
    };

    // The REAL guard, not a stub — the point is that this service refuses an orphan
    // through the same class every other trigger raises.
    const returns = new ReturnsService(
      repository as unknown as ReturnRepositoryPort,
      { getInternalId: jest.fn(), getExternalIds: jest.fn() } as never,
      { getAdapter: jest.fn(), listCapabilityAdapters: jest.fn() } as never
    );

    service = new ReturnAuthorizeService(
      repository as unknown as ReturnRepositoryPort,
      returns,
      orderChanges
    );
  });

  it('should authorize an operator-authored return and record it as an order change', async () => {
    repository.findById.mockResolvedValue(buildReturn());

    const result = await service.authorize(input);

    expect(result.outcome).toBe('authorized');
    expect(result.changeId).toBe('change-auth-1');
    expect(result.authorizedAt).toBeInstanceOf(Date);

    expect(orderChanges.openOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({
        internalOrderId: ORDER_ID,
        kind: 'return.authorize',
        targetRef: RETURN_ID,
        requestedBy: 'user-1',
      })
    );
    expect(repository.claimAuthorizedAt).toHaveBeenCalledWith(RETURN_ID, result.authorizedAt);
  });

  it('should refuse a source_ingested return with an explaining error', async () => {
    repository.findById.mockResolvedValue(buildReturn({ origin: 'source_ingested' }));

    const error = await service.authorize(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReturnAuthorizeRefusedError);
    expect((error as ReturnAuthorizeRefusedError).reason).toBe('source-ingested');
    // Refused BEFORE anything is written — the marketplace already decided.
    expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
    expect(repository.claimAuthorizedAt).not.toHaveBeenCalled();
  });

  it('should refuse an orphan return with the SAME class the trigger guard raises', async () => {
    repository.findById.mockResolvedValue(buildReturn({ internalOrderId: null }));

    const error = await service.authorize(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReturnNotAttributedError);
    expect((error as ReturnNotAttributedError).trigger).toBe('authorize');
    expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
  });

  it('should raise ReturnNotFoundError when the id resolves to no row', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.authorize(input)).rejects.toBeInstanceOf(ReturnNotFoundError);
  });

  it('should be idempotent when the return is already authorized', async () => {
    repository.findById.mockResolvedValue(buildReturn({ authorizedAt: ALREADY_AT }));
    orderChanges.findLatestByTarget.mockResolvedValue(buildChange('change-earlier'));

    const result = await service.authorize(input);

    expect(result).toEqual({
      outcome: 'already-authorized',
      changeId: 'change-earlier',
      authorizedAt: ALREADY_AT,
    });
    expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
    expect(repository.claimAuthorizedAt).not.toHaveBeenCalled();
  });

  it('should report a null changeId when an already-authorized return has no proposal row', async () => {
    repository.findById.mockResolvedValue(buildReturn({ authorizedAt: ALREADY_AT }));

    const result = await service.authorize(input);

    expect(result.outcome).toBe('already-authorized');
    expect(result.changeId).toBeNull();
  });

  it('should PROCEED through a reused open proposal rather than aborting like decline', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    orderChanges.openOrReuse.mockResolvedValue({
      change: buildChange('change-inflight'),
      opened: false,
      expiredStale: false,
    });

    const result = await service.authorize(input);

    // No remote request exists to duplicate, so refusing here would only wedge the
    // return behind the proposal's TTL. `claimAuthorizedAt` is the real guard.
    expect(result.outcome).toBe('authorized');
    expect(orderChanges.confirm).toHaveBeenCalledWith('change-inflight', 'operator:user-1');
    expect(repository.claimAuthorizedAt).toHaveBeenCalled();
  });

  it('should not stamp authorizedAt when the applied claim is lost', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    orderChanges.claimApplied.mockResolvedValue(false);

    const result = await service.authorize(input);

    expect(result.outcome).toBe('authorized');
    expect(repository.claimAuthorizedAt).not.toHaveBeenCalled();
  });

  it('should still stamp when the confirm lost its race, since the stamp is itself conditional', async () => {
    repository.findById.mockResolvedValue(buildReturn());
    orderChanges.confirm.mockResolvedValue(false);

    await service.authorize(input);

    expect(repository.claimAuthorizedAt).toHaveBeenCalled();
  });
});
