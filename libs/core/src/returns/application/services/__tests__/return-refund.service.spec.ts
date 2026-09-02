/**
 * Return Refund Service Tests (#2371, `W2-34`, ADR-056)
 *
 * Covers the six rules the service header states, and the four acceptance
 * criteria the issue names — most importantly the ORDERING (the attempt is
 * persisted before the provider call, asserted with a throwing fake executor)
 * and the fact that the no-executor path never claims `in_doubt`.
 *
 * @module libs/core/src/returns/application/services/__tests__
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { RefundExecutionResult, RefundExecutor } from '@openlinker/core/orders';
import type { SyncLockPort } from '@openlinker/core/sync';

import { ReturnLine } from '../../../domain/entities/return-line.entity';
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import { ReturnNotAttributedError } from '../../../domain/exceptions/return-not-attributed.error';
import { ReturnRefundBlockedError } from '../../../domain/exceptions/return-refund-blocked.error';
import { ReturnRefundContendedError } from '../../../domain/exceptions/return-refund-contended.error';
import { ReturnRefundObservationInvalidError } from '../../../domain/exceptions/return-refund-observation-invalid.error';
import type { ReturnRepositoryPort } from '../../../domain/ports/return-repository.port';
import type { ReturnMoneyState } from '../../../domain/types/return-line.types';
import { ReturnRefundService } from '../return-refund.service';
import type { IReturnsService } from '../returns.service.interface';

const RETURN_ID = 'ol_return_1';
const ORDER_ID = 'ol_order_1';
const CONNECTION_ID = 'conn-1';
const LINE_ID = 'line-1';
const PROVIDER_INSTANT = new Date('2026-08-26T10:00:00.000Z');

function buildLine(moneyState: ReturnMoneyState = 'not_refundable'): ReturnLine {
  return new ReturnLine(
    LINE_ID,
    RETURN_ID,
    0,
    null,
    null,
    null,
    'SKU-1',
    'Widget',
    'withdrawal',
    2,
    2,
    0,
    0,
    'received',
    moneyState,
    null,
    null,
    null,
    null,
    new Date(),
    new Date()
  );
}

function buildReturn(overrides: { internalOrderId?: string | null } = {}): ReturnRecord {
  return new ReturnRecord(
    RETURN_ID,
    CONNECTION_ID,
    'ext-return-1',
    overrides.internalOrderId === undefined ? ORDER_ID : overrides.internalOrderId,
    'ext-order-1',
    'source_ingested',
    'DELIVERED',
    null,
    null,
    null,
    null,
    null,
    new Date(),
    new Date(),
    [buildLine()]
  );
}

const INPUT = {
  amount: '19.99',
  currency: 'PLN',
  reason: 'withdrawal' as const,
  note: null,
};

describe('ReturnRefundService', () => {
  let repository: jest.Mocked<ReturnRepositoryPort>;
  let returns: jest.Mocked<IReturnsService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let lock: jest.Mocked<SyncLockPort>;
  let service: ReturnRefundService;

  /** Records the order of the two calls the ADR-056 ordering is about. */
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];

    repository = {
      findById: jest.fn().mockResolvedValue(buildReturn()),
      claimRefundAttempt: jest.fn().mockImplementation(() => {
        callOrder.push('claim');
        return Promise.resolve([LINE_ID]);
      }),
      settleRefundState: jest.fn().mockResolvedValue(1),
      listLineMoneyStates: jest.fn().mockResolvedValue(['not_refundable']),
    } as unknown as jest.Mocked<ReturnRepositoryPort>;

    returns = {
      assertAttributedForTrigger: jest.fn().mockResolvedValue(buildReturn()),
    } as unknown as jest.Mocked<IReturnsService>;

    integrations = {
      // No adapter satisfies `isRefundExecutor` unless a test supplies one.
      getCapabilityAdapter: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<IIntegrationsService>;

    lock = {
      acquire: jest.fn().mockResolvedValue('token-1'),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SyncLockPort>;

    service = new ReturnRefundService(repository, returns, integrations, lock);
  });

  function withExecutor(behaviour: () => Promise<RefundExecutionResult>): jest.Mock {
    const executeRefund = jest.fn().mockImplementation(() => {
      callOrder.push('execute');
      return behaviour();
    });
    const executor: RefundExecutor = { executeRefund };
    integrations.getCapabilityAdapter = jest.fn().mockResolvedValue(executor);
    return executeRefund;
  }

  describe('triggerRefund — the ADR-056 attempted-predicate ordering', () => {
    it('should persist the attempt BEFORE calling the executor when the executor throws', async () => {
      withExecutor(() => Promise.reject(new Error('gateway timeout')));

      const result = await service.triggerRefund(RETURN_ID, INPUT);

      // The whole point: the claim resolved first, so a process dying mid-call
      // leaves a durable record rather than silence.
      expect(callOrder).toEqual(['claim', 'execute']);
      expect(repository.claimRefundAttempt).toHaveBeenCalledWith(
        RETURN_ID,
        'in_doubt',
        expect.any(Date)
      );
      expect(result.moneyState).toBe('in_doubt');
      // No money is claimed to have moved, so nothing is proposed for recording.
      expect(result.refundRecordIntent).toBeNull();
    });

    it('should claim `triggered` and never `in_doubt` when no executor exists', async () => {
      const result = await service.triggerRefund(RETURN_ID, INPUT);

      // The only path reachable today: nothing crossed a boundary, so asserting
      // doubt would be a false statement about the operator's money.
      expect(repository.claimRefundAttempt).toHaveBeenCalledWith(
        RETURN_ID,
        'triggered',
        expect.any(Date)
      );
      expect(repository.claimRefundAttempt).not.toHaveBeenCalledWith(
        RETURN_ID,
        'in_doubt',
        expect.any(Date)
      );
      // Nothing to settle — the claim already landed on the final state.
      expect(repository.settleRefundState).not.toHaveBeenCalled();
      expect(result.moneyState).toBe('triggered');
    });

    it('should report an out-of-band record intent when no executor exists', async () => {
      const result = await service.triggerRefund(RETURN_ID, INPUT);

      expect(result.refundRecordIntent).toEqual({
        returnId: RETURN_ID,
        internalOrderId: ORDER_ID,
        amount: '19.99',
        currency: 'PLN',
        reason: 'withdrawal',
        note: null,
        executedBy: 'operator_out_of_band',
        recordedAt: expect.any(Date),
        providerRefundId: null,
      });
    });

  });

  describe('triggerRefund — refusals', () => {
    it('should refuse an orphan return before writing anything', async () => {
      returns.assertAttributedForTrigger = jest
        .fn()
        .mockRejectedValue(new ReturnNotAttributedError(RETURN_ID, 'refund'));

      await expect(service.triggerRefund(RETURN_ID, INPUT)).rejects.toBeInstanceOf(
        ReturnNotAttributedError
      );

      expect(lock.acquire).not.toHaveBeenCalled();
      expect(repository.claimRefundAttempt).not.toHaveBeenCalled();
    });

    it('should refuse a contended attempt before reaching the executor', async () => {
      const executeRefund = withExecutor(() =>
        Promise.resolve({
          outcome: 'refunded',
          providerRefundId: null,
          refundedAt: PROVIDER_INSTANT,
          providerMessage: null,
        })
      );
      lock.acquire = jest.fn().mockResolvedValue(null);

      await expect(service.triggerRefund(RETURN_ID, INPUT)).rejects.toBeInstanceOf(
        ReturnRefundContendedError
      );

      expect(executeRefund).not.toHaveBeenCalled();
      expect(repository.claimRefundAttempt).not.toHaveBeenCalled();
    });

    it('should refuse a second attempt once a line is in doubt, naming the reason', async () => {
      repository.claimRefundAttempt = jest.fn().mockResolvedValue([]);
      repository.listLineMoneyStates = jest.fn().mockResolvedValue(['in_doubt']);

      await expect(service.triggerRefund(RETURN_ID, INPUT)).rejects.toMatchObject({
        name: 'ReturnRefundBlockedError',
        reason: 'outstanding-in-doubt',
      });
    });

    it('should refuse an already-attempted return with its own reason', async () => {
      repository.claimRefundAttempt = jest.fn().mockResolvedValue([]);
      repository.listLineMoneyStates = jest.fn().mockResolvedValue(['triggered']);

      await expect(service.triggerRefund(RETURN_ID, INPUT)).rejects.toMatchObject({
        reason: 'already-attempted',
      });
    });

    it('should refuse a return with no lines with its own reason', async () => {
      repository.claimRefundAttempt = jest.fn().mockResolvedValue([]);
      repository.listLineMoneyStates = jest.fn().mockResolvedValue([]);

      await expect(service.triggerRefund(RETURN_ID, INPUT)).rejects.toMatchObject({
        reason: 'no-lines',
      });
      expect(ReturnRefundBlockedError).toBeDefined();
    });

    it('should release the lock even when the attempt is refused', async () => {
      repository.claimRefundAttempt = jest.fn().mockResolvedValue([]);

      await expect(service.triggerRefund(RETURN_ID, INPUT)).rejects.toBeInstanceOf(
        ReturnRefundBlockedError
      );

      expect(lock.release).toHaveBeenCalledWith(`return:refund:${RETURN_ID}`, 'token-1');
    });
  });

  describe('triggerRefund — executor outcomes', () => {
    it('should settle `refunded` when the source reported its own instant', async () => {
      withExecutor(() =>
        Promise.resolve({
          outcome: 'refunded',
          providerRefundId: 'prov-1',
          refundedAt: PROVIDER_INSTANT,
          providerMessage: null,
        })
      );

      const result = await service.triggerRefund(RETURN_ID, INPUT);

      expect(result.moneyState).toBe('refunded');
      expect(repository.settleRefundState).toHaveBeenCalledWith(
        RETURN_ID,
        [LINE_ID],
        'refunded',
        ['in_doubt']
      );
      expect(result.refundRecordIntent).toMatchObject({
        executedBy: 'refund_executor',
        recordedAt: PROVIDER_INSTANT,
        providerRefundId: 'prov-1',
      });
    });

    it('should downgrade a `refunded` claim carrying no instant to `triggered`', async () => {
      withExecutor(() =>
        Promise.resolve({
          outcome: 'refunded',
          providerRefundId: null,
          refundedAt: null,
          providerMessage: null,
        })
      );

      const result = await service.triggerRefund(RETURN_ID, INPUT);

      // OL's clock may never stand in for a channel-reported fact.
      expect(result.moneyState).toBe('triggered');
    });

    it('should settle `denied` and propose no record when the source refused', async () => {
      withExecutor(() =>
        Promise.resolve({
          outcome: 'denied',
          providerRefundId: null,
          refundedAt: null,
          providerMessage: 'refund window closed',
        })
      );

      const result = await service.triggerRefund(RETURN_ID, INPUT);

      expect(result.moneyState).toBe('denied');
      expect(result.refundRecordIntent).toBeNull();
      expect(result.providerMessage).toBe('refund window closed');
    });

    it('should send a deterministic idempotency key built from the claimed attempt', async () => {
      const executeRefund = withExecutor(() =>
        Promise.resolve({
          outcome: 'accepted',
          providerRefundId: null,
          refundedAt: null,
          providerMessage: null,
        })
      );

      await service.triggerRefund(RETURN_ID, INPUT);

      expect(executeRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          externalOrderId: 'ext-order-1',
          externalReturnId: 'ext-return-1',
          idempotencyKey: `refund:${RETURN_ID}:${LINE_ID}`,
        })
      );
    });
  });

  describe('recordRefundObservation', () => {
    it('should refuse a `refunded` observation with no source instant', async () => {
      await expect(
        service.recordRefundObservation(RETURN_ID, { observedState: 'refunded' })
      ).rejects.toBeInstanceOf(ReturnRefundObservationInvalidError);

      expect(repository.settleRefundState).not.toHaveBeenCalled();
    });

    it('should record `refunded` when the source instant is supplied', async () => {
      await service.recordRefundObservation(RETURN_ID, {
        observedState: 'refunded',
        observedAt: PROVIDER_INSTANT,
      });

      // The observation may resolve a line an attempt left `triggered` as well
      // as one left `in_doubt` — and must never re-open a settled `refunded`.
      expect(repository.settleRefundState).toHaveBeenCalledWith(
        RETURN_ID,
        [LINE_ID],
        'refunded',
        ['triggered', 'in_doubt']
      );
    });

    it('should refuse a contended observation rather than racing a live trigger', async () => {
      // The observation writes the same column the trigger claims, so it takes
      // the same per-return lock.
      lock.acquire = jest.fn().mockResolvedValue(null);

      await expect(
        service.recordRefundObservation(RETURN_ID, { observedState: 'denied' })
      ).rejects.toBeInstanceOf(ReturnRefundContendedError);

      expect(repository.settleRefundState).not.toHaveBeenCalled();
    });

    it('should not report success when the observation matched no standing attempt', async () => {
      // The source reported an outcome for a return OL never triggered. Nothing
      // changed, and saying nothing would be the silent decline RULE 6 forbids.
      repository.settleRefundState = jest.fn().mockResolvedValue(0);
      const warn = jest
        .spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);

      await service.recordRefundObservation(RETURN_ID, { observedState: 'denied' });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no line was awaiting an outcome'));
    });

    it('should clear the block on a terminal `denied` so another attempt is permitted', async () => {
      await service.recordRefundObservation(RETURN_ID, { observedState: 'denied' });

      expect(repository.settleRefundState).toHaveBeenCalledWith(
        RETURN_ID,
        [LINE_ID],
        'denied',
        ['triggered', 'in_doubt']
      );
    });
  });
});
