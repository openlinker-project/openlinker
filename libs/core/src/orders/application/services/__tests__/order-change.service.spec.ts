/**
 * Order Change Service Tests (#2333, ADR-044)
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderChange } from '../../../domain/entities/order-change.entity';
import type { OrderChangeRepositoryPort } from '../../../domain/ports/order-change-repository.port';
import type {
  CreateOrderChangeInput,
  OrderChangeStatus,
} from '../../../domain/types/order-change.types';
import { OrderChangeService } from '../order-change.service';

const ORDER_ID = 'ol_order_1';
const TARGET = 'ol_return_1';

function buildChange(
  overrides: { id?: string; status?: OrderChangeStatus; requestedAt?: Date } = {}
): OrderChange {
  const at = overrides.requestedAt ?? new Date('2026-08-25T10:00:00.000Z');
  return new OrderChange(
    overrides.id ?? 'change-1',
    ORDER_ID,
    'return.decline',
    TARGET,
    overrides.status ?? 'requested',
    null,
    'user-1',
    at,
    null,
    null,
    null,
    null,
    at,
    at
  );
}

function buildInput(requestedAt: Date): CreateOrderChangeInput {
  return {
    internalOrderId: ORDER_ID,
    kind: 'return.decline',
    targetRef: TARGET,
    payload: { reasonCode: 'REFUND_REJECTED' },
    requestedBy: 'user-1',
    requestedAt,
  };
}

describe('OrderChangeService', () => {
  let repository: jest.Mocked<OrderChangeRepositoryPort>;
  let service: OrderChangeService;

  beforeEach(() => {
    repository = {
      findOpenByTarget: jest.fn(),
      findLatestByTarget: jest.fn(),
      insertRequested: jest.fn(),
      confirm: jest.fn(),
      decline: jest.fn(),
      expire: jest.fn(),
      claimApplied: jest.fn(),
    };
    service = new OrderChangeService(repository);
    delete process.env.OL_ORDER_CHANGE_OPEN_TTL_MS;
  });

  afterEach(() => {
    delete process.env.OL_ORDER_CHANGE_OPEN_TTL_MS;
  });

  describe('openOrReuse', () => {
    it('should insert a fresh proposal when no open change holds the target', async () => {
      const requestedAt = new Date('2026-08-25T12:00:00.000Z');
      repository.findOpenByTarget.mockResolvedValue(null);
      repository.insertRequested.mockResolvedValue({
        change: buildChange({ requestedAt }),
        inserted: true,
      });

      const result = await service.openOrReuse(buildInput(requestedAt));

      expect(result.opened).toBe(true);
      expect(result.expiredStale).toBe(false);
      expect(repository.expire).not.toHaveBeenCalled();
    });

    it('should reuse an open proposal inside the TTL without inserting a second one', async () => {
      const openedAt = new Date('2026-08-25T12:00:00.000Z');
      const requestedAt = new Date('2026-08-25T12:05:00.000Z');
      repository.findOpenByTarget.mockResolvedValue(
        buildChange({ requestedAt: openedAt })
      );

      const result = await service.openOrReuse(buildInput(requestedAt));

      expect(result.opened).toBe(false);
      expect(result.change.id).toBe('change-1');
      expect(repository.insertRequested).not.toHaveBeenCalled();
      expect(repository.expire).not.toHaveBeenCalled();
    });

    it('should expire a stale open proposal and open a fresh one when the TTL has passed', async () => {
      const openedAt = new Date('2026-08-25T12:00:00.000Z');
      const requestedAt = new Date('2026-08-25T12:30:00.000Z');
      repository.findOpenByTarget.mockResolvedValue(
        buildChange({ requestedAt: openedAt })
      );
      repository.expire.mockResolvedValue(true);
      repository.insertRequested.mockResolvedValue({
        change: buildChange({ id: 'change-2', requestedAt }),
        inserted: true,
      });

      const result = await service.openOrReuse(buildInput(requestedAt));

      expect(repository.expire).toHaveBeenCalledWith('change-1', requestedAt);
      expect(result.expiredStale).toBe(true);
      expect(result.opened).toBe(true);
      expect(result.change.id).toBe('change-2');
    });

    it('should report opened=false when insertRequested returns a peer row after a conflict', async () => {
      // The repository RESOLVES a unique violation by returning the winner and
      // says so; the caller never infers ownership from the row's own fields.
      const requestedAt = new Date('2026-08-25T12:00:00.000Z');
      repository.findOpenByTarget.mockResolvedValue(null);
      repository.insertRequested.mockResolvedValue({
        change: buildChange({ requestedAt }),
        inserted: false,
      });

      const result = await service.openOrReuse(buildInput(requestedAt));

      expect(result.opened).toBe(false);
    });

    it('should clamp an out-of-range TTL rather than trusting it', async () => {
      // Zero would expire every proposal the instant it was opened, silently
      // turning the double-call guard off.
      process.env.OL_ORDER_CHANGE_OPEN_TTL_MS = '0';
      const openedAt = new Date('2026-08-25T12:00:00.000Z');
      const requestedAt = new Date('2026-08-25T12:05:00.000Z');
      repository.findOpenByTarget.mockResolvedValue(
        buildChange({ requestedAt: openedAt })
      );

      const result = await service.openOrReuse(buildInput(requestedAt));

      expect(result.opened).toBe(false);
      expect(repository.expire).not.toHaveBeenCalled();
    });

    it('should honour a valid TTL override', async () => {
      process.env.OL_ORDER_CHANGE_OPEN_TTL_MS = String(2 * 60 * 1000);
      const openedAt = new Date('2026-08-25T12:00:00.000Z');
      const requestedAt = new Date('2026-08-25T12:05:00.000Z');
      repository.findOpenByTarget.mockResolvedValue(
        buildChange({ requestedAt: openedAt })
      );
      repository.expire.mockResolvedValue(true);
      repository.insertRequested.mockResolvedValue({
        change: buildChange({ id: 'change-2', requestedAt }),
        inserted: true,
      });

      const result = await service.openOrReuse(buildInput(requestedAt));

      expect(result.expiredStale).toBe(true);
    });
  });

  it('should pass confirm, decline and claimApplied through to the repository', async () => {
    repository.confirm.mockResolvedValue(true);
    repository.decline.mockResolvedValue(true);
    repository.claimApplied.mockResolvedValue(true);

    await expect(service.confirm('change-1', 'source:conn-1')).resolves.toBe(true);
    await expect(service.decline('change-1', 'nope')).resolves.toBe(true);
    await expect(service.claimApplied('change-1')).resolves.toBe(true);

    expect(repository.decline).toHaveBeenCalledWith('change-1', expect.any(Date), 'nope');
  });
});
