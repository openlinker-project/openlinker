/**
 * Order FX Stamp Service Spec (#2125, ADR-040)
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import {
  RateUnsupportedPairError,
  RateUnavailableTransientError,
  UnregisteredExchangeRateSourceError,
} from '@openlinker/core/currency';
import type {
  ICurrencyRateService,
  IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import { OrderFxStampService } from '../order-fx-stamp.service';

function buildRecord(overrides: {
  internalOrderId?: string;
  sourceConnectionId?: string;
  totals?: { total: number; currency: string } | null;
  placedAt?: string | null;
  reportingCurrency?: string | null;
  reportingTotalAmount?: number | null;
  exchangeRateId?: string | null;
  fxRule?: string | null;
  fxStampedAt?: Date | null;
  fxIntendedCurrency?: string | null;
}): OrderRecord {
  const snapshot: Record<string, unknown> = {};
  if (overrides.totals !== null) {
    snapshot.totals = overrides.totals ?? { total: 100, currency: 'EUR' };
  }

  const placedAt =
    overrides.placedAt === null
      ? null
      : new Date(overrides.placedAt ?? '2026-06-10T09:00:00.000Z');

  return new OrderRecord(
    overrides.internalOrderId ?? 'ol_order_1',
    null,
    overrides.sourceConnectionId ?? 'conn_1',
    'evt_1',
    snapshot,
    [],
    'ready',
    new Date('2026-06-10T09:05:00.000Z'),
    new Date('2026-06-10T09:05:00.000Z'),
    [],
    null,
    null,
    null,
    placedAt,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    overrides.reportingCurrency ?? null,
    overrides.reportingTotalAmount ?? null,
    overrides.exchangeRateId ?? null,
    overrides.fxRule ?? null,
    overrides.fxStampedAt ?? null,
    overrides.fxIntendedCurrency ?? null
  );
}

describe('OrderFxStampService', () => {
  let repository: jest.Mocked<OrderRecordRepositoryPort>;
  let settings: jest.Mocked<IReportingCurrencySettingsService>;
  let rates: jest.Mocked<ICurrencyRateService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let service: OrderFxStampService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      claimFxIntentIfAbsent: jest.fn(),
      stampFxIfAbsent: jest.fn(),
      markFxTerminal: jest.fn(),
      findUnstampedFxOrderIds: jest.fn(),
    } as unknown as jest.Mocked<OrderRecordRepositoryPort>;

    settings = {
      resolve: jest.fn(),
      getView: jest.fn(),
      setReportingCurrency: jest.fn(),
      listSelectableCurrencies: jest.fn(),
    } as unknown as jest.Mocked<IReportingCurrencySettingsService>;

    rates = {
      getRateFor: jest.fn(),
    } as unknown as jest.Mocked<ICurrencyRateService>;

    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    settings.resolve.mockResolvedValue('PLN');
    repository.claimFxIntentIfAbsent.mockResolvedValue(true);
    repository.stampFxIfAbsent.mockResolvedValue(true);
    repository.markFxTerminal.mockResolvedValue(true);
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'job_1', isExisting: false });

    service = new OrderFxStampService(repository, settings, rates, jobEnqueue);
  });

  describe('already stamped', () => {
    it('should report the existing figure and touch nothing when the row is already stamped', async () => {
      const record = buildRecord({ reportingCurrency: 'PLN', reportingTotalAmount: 425 });
      repository.findById.mockResolvedValue(record);

      const outcome = await service.stamp('ol_order_1');

      expect(outcome).toEqual({
        kind: 'stamped',
        reportingCurrency: 'PLN',
        reportingTotalAmount: 425,
        exchangeRateId: null,
        alreadyStamped: true,
      });
      expect(settings.resolve).not.toHaveBeenCalled();
      expect(rates.getRateFor).not.toHaveBeenCalled();
      expect(repository.claimFxIntentIfAbsent).not.toHaveBeenCalled();
      expect(repository.stampFxIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe('order not found', () => {
    it('should return terminal order-not-found without any write', async () => {
      repository.findById.mockResolvedValue(null);

      const outcome = await service.stamp('ol_order_missing');

      expect(outcome).toEqual({ kind: 'terminal', reason: 'order-not-found' });
      expect(repository.markFxTerminal).not.toHaveBeenCalled();
    });
  });

  describe('equal-currency path', () => {
    it('should stamp with no rate lookup when the native currency already equals the reporting currency', async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'PLN' } });
      repository.findById.mockResolvedValue(record);

      const outcome = await service.stamp('ol_order_1');

      expect(rates.getRateFor).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        kind: 'stamped',
        reportingCurrency: 'PLN',
        reportingTotalAmount: 100,
        exchangeRateId: null,
        alreadyStamped: false,
      });
      expect(repository.stampFxIfAbsent).toHaveBeenCalledWith(
        'ol_order_1',
        expect.objectContaining({
          reportingCurrency: 'PLN',
          reportingTotalAmount: 100,
          exchangeRateId: null,
        })
      );
    });
  });

  describe('converting path', () => {
    it('should multiply and round to an EXACT figure for a whole-number rate', async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'EUR' } });
      repository.findById.mockResolvedValue(record);
      rates.getRateFor.mockResolvedValue({ id: 'rate_1', rate: '4.25' } as never);

      const outcome = await service.stamp('ol_order_1');

      expect(outcome).toEqual({
        kind: 'stamped',
        reportingCurrency: 'PLN',
        reportingTotalAmount: 425,
        exchangeRateId: 'rate_1',
        alreadyStamped: false,
      });
      expect(rates.getRateFor).toHaveBeenCalledWith({
        source: 'nbp',
        from: 'EUR',
        to: 'PLN',
        rateDate: '2026-06-09',
      });
    });

    it('should multiply and round to an EXACT figure for a non-trivial rate', async () => {
      const record = buildRecord({ totals: { total: 123.45, currency: 'EUR' } });
      repository.findById.mockResolvedValue(record);
      rates.getRateFor.mockResolvedValue({ id: 'rate_2', rate: '1.08974359' } as never);

      const outcome = await service.stamp('ol_order_1');

      expect(outcome.kind).toBe('stamped');
      expect((outcome as { reportingTotalAmount: number }).reportingTotalAmount).toBe(134.53);
    });

    it('should never divide - the rate is applied as a multiplier, not an inverse', async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'EUR' } });
      repository.findById.mockResolvedValue(record);
      // A rate of 4 applied by division would report 25.00; multiplication
      // reports 400.00. Pinning the multiplied value catches an inverted
      // arithmetic regression that a same-currency test cannot.
      rates.getRateFor.mockResolvedValue({ id: 'rate_3', rate: '4' } as never);

      const outcome = await service.stamp('ol_order_1');

      expect((outcome as { reportingTotalAmount: number }).reportingTotalAmount).toBe(400);
    });
  });

  describe('terminal: no placedAt', () => {
    it('should return terminal no-placed-at and enqueue ZERO retries', async () => {
      const record = buildRecord({ placedAt: null });
      repository.findById.mockResolvedValue(record);

      const outcome = await service.stamp('ol_order_1');

      expect(outcome).toEqual({ kind: 'terminal', reason: 'no-placed-at' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      expect(rates.getRateFor).not.toHaveBeenCalled();
    });
  });

  describe('terminal: no native total', () => {
    it('should return terminal no-native-total when the snapshot carries no well-formed totals', async () => {
      const record = buildRecord({ totals: null });
      repository.findById.mockResolvedValue(record);

      const outcome = await service.stamp('ol_order_1');

      expect(outcome).toEqual({ kind: 'terminal', reason: 'no-native-total' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });
  });

  describe('terminal: unsupported pair / source', () => {
    it('should classify RateUnsupportedPairError as terminal and mark the row', async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'TRY' } });
      repository.findById.mockResolvedValue(record);
      rates.getRateFor.mockRejectedValue(
        new RateUnsupportedPairError('nbp', 'TRY', 'PLN', '2026-06-09', 'no series for TRY')
      );

      const outcome = await service.stamp('ol_order_1');

      expect(outcome).toEqual({ kind: 'terminal', reason: 'unsupported-pair' });
      expect(repository.markFxTerminal).toHaveBeenCalledWith('ol_order_1', expect.any(Date));
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should classify UnregisteredExchangeRateSourceError as terminal', async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'EUR' } });
      repository.findById.mockResolvedValue(record);
      rates.getRateFor.mockRejectedValue(new UnregisteredExchangeRateSourceError('nbp', []));

      const outcome = await service.stamp('ol_order_1');

      expect(outcome).toEqual({ kind: 'terminal', reason: 'no-rate-source' });
    });

    it('should classify ReportingCurrencyUnsupportedError as terminal', async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'EUR' } });
      repository.findById.mockResolvedValue(record);
      settings.resolve.mockResolvedValue('XXX');

      const outcome = await service.stamp('ol_order_1');

      expect(outcome).toEqual({ kind: 'terminal', reason: 'unsupported-reporting-currency' });
    });
  });

  describe('deferred: transient provider failure', () => {
    it('should leave the order persisted and unstamped, not propagate, and enqueue exactly one job', async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'EUR' } });
      repository.findById.mockResolvedValue(record);
      rates.getRateFor.mockRejectedValue(
        new RateUnavailableTransientError('nbp', 'EUR', 'PLN', '2026-06-09', 'network timeout')
      );

      const outcome = await service.stamp('ol_order_1');

      expect(outcome.kind).toBe('deferred');
      expect((outcome as { retryEnqueued: boolean }).retryEnqueued).toBe(true);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'marketplace.order.fxStamp',
          idempotencyKey: 'fx:ol_order_1',
        })
      );
      expect(repository.markFxTerminal).not.toHaveBeenCalled();
    });

    it('should NOT propagate and should log distinctly when the enqueue itself throws', async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'EUR' } });
      repository.findById.mockResolvedValue(record);
      rates.getRateFor.mockRejectedValue(new Error('rate provider down'));
      jobEnqueue.enqueueJob.mockRejectedValue(new Error('redis unreachable'));

      const outcome = await service.stamp('ol_order_1');

      expect(outcome.kind).toBe('deferred');
      expect((outcome as { retryEnqueued: boolean }).retryEnqueued).toBe(false);
    });
  });

  describe('the persisted intent', () => {
    it('should use a populated fxIntendedCurrency and never call the settings service, even after the live setting changed', async () => {
      const record = buildRecord({
        totals: { total: 100, currency: 'EUR' },
        fxIntendedCurrency: 'EUR',
        fxRule: 'prev-business-day',
      });
      repository.findById.mockResolvedValue(record);
      // The live setting has since moved to PLN - must not be consulted.
      settings.resolve.mockResolvedValue('PLN');

      const outcome = await service.stamp('ol_order_1');

      expect(settings.resolve).not.toHaveBeenCalled();
      expect(repository.claimFxIntentIfAbsent).not.toHaveBeenCalled();
      expect(outcome.kind).toBe('stamped');
      expect((outcome as { reportingCurrency: string }).reportingCurrency).toBe('EUR');
      // EUR native, EUR intent -> no conversion needed.
      expect(rates.getRateFor).not.toHaveBeenCalled();
    });

    it('should resolve the CURRENT reporting currency once a restatement page cleared a deferred row (#2775)', async () => {
      // The deferred shape carries a pinned intent and no figure. Before #2775
      // the restatement clear skipped it, `resolveIntent` re-pinned the stale
      // currency, and the run could never converge. After the clear all six FX
      // columns are NULL, so the settings service is consulted again.
      const clearedRecord = buildRecord({
        totals: { total: 100, currency: 'EUR' },
        fxIntendedCurrency: null,
        fxRule: null,
      });
      repository.findById.mockResolvedValue(clearedRecord);
      repository.claimFxIntentIfAbsent.mockResolvedValue(true);
      settings.resolve.mockResolvedValue('EUR');

      const outcome = await service.stamp('ol_order_1');

      expect(settings.resolve).toHaveBeenCalled();
      expect(repository.claimFxIntentIfAbsent).toHaveBeenCalledWith(
        'ol_order_1',
        expect.objectContaining({ reportingCurrency: 'EUR' })
      );
      expect(outcome.kind).toBe('stamped');
      expect((outcome as { reportingCurrency: string }).reportingCurrency).toBe('EUR');
    });

    it("should adopt the winner's intent when the intent claim is lost", async () => {
      const record = buildRecord({ totals: { total: 100, currency: 'EUR' } });
      const winnerRecord = buildRecord({
        totals: { total: 100, currency: 'EUR' },
        fxIntendedCurrency: 'PLN',
        fxRule: 'prev-business-day',
      });
      repository.findById.mockResolvedValueOnce(record).mockResolvedValueOnce(winnerRecord);
      repository.claimFxIntentIfAbsent.mockResolvedValue(false);
      settings.resolve.mockResolvedValue('EUR');
      rates.getRateFor.mockResolvedValue({ id: 'rate_1', rate: '4.25' } as never);

      const outcome = await service.stamp('ol_order_1');

      expect(outcome.kind).toBe('stamped');
      expect((outcome as { reportingCurrency: string }).reportingCurrency).toBe('PLN');
      expect(rates.getRateFor).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'EUR', to: 'PLN' })
      );
    });
  });

  describe('sweep', () => {
    it('should tally scanned/stamped/terminal/deferred and never abort on one bad row', async () => {
      repository.findUnstampedFxOrderIds.mockResolvedValue(['a', 'b', 'c']);

      const stampedRecord = buildRecord({
        internalOrderId: 'a',
        totals: { total: 10, currency: 'PLN' },
      });
      const terminalRecord = buildRecord({ internalOrderId: 'b', placedAt: null });
      const deferredRecord = buildRecord({
        internalOrderId: 'c',
        totals: { total: 10, currency: 'EUR' },
      });

      repository.findById.mockImplementation((id: string) => {
        if (id === 'a') return Promise.resolve(stampedRecord);
        if (id === 'b') return Promise.resolve(terminalRecord);
        if (id === 'c') return Promise.resolve(deferredRecord);
        return Promise.resolve(null);
      });
      rates.getRateFor.mockRejectedValue(new Error('transient'));

      const result = await service.sweep('conn_1', {
        limit: 100,
        createdSince: new Date('2026-01-01'),
        terminalRetryBefore: new Date('2026-01-08'),
      });

      expect(result).toEqual({ scanned: 3, stamped: 1, terminal: 1, deferred: 1 });
      expect(repository.findUnstampedFxOrderIds).toHaveBeenCalledWith('conn_1', {
        limit: 100,
        createdSince: new Date('2026-01-01'),
        terminalRetryBefore: new Date('2026-01-08'),
      });
    });

    it('should pass the terminal-retry cooldown through so an aged terminal row can be re-admitted', async () => {
      // #2135 review, finding 1: the cooldown is the ONLY recovery path out of a
      // terminal answer, so the sweep must forward it verbatim rather than
      // deriving its own bound.
      repository.findUnstampedFxOrderIds.mockResolvedValue([]);

      await service.sweep('conn_1', {
        limit: 50,
        createdSince: new Date('2026-01-01'),
        terminalRetryBefore: new Date('2026-02-01T12:00:00.000Z'),
      });

      expect(repository.findUnstampedFxOrderIds).toHaveBeenCalledWith('conn_1', {
        limit: 50,
        createdSince: new Date('2026-01-01'),
        terminalRetryBefore: new Date('2026-02-01T12:00:00.000Z'),
      });
    });

    it('should not double-count an already-stamped row raced by a concurrent inline attempt', async () => {
      repository.findUnstampedFxOrderIds.mockResolvedValue(['a']);
      const record = buildRecord({
        internalOrderId: 'a',
        reportingCurrency: 'PLN',
        reportingTotalAmount: 10,
      });
      repository.findById.mockResolvedValue(record);

      const result = await service.sweep('conn_1', {
        limit: 100,
        createdSince: new Date('2026-01-01'),
        terminalRetryBefore: new Date('2026-01-08'),
      });

      expect(result).toEqual({ scanned: 1, stamped: 0, terminal: 0, deferred: 0 });
    });
  });
});
