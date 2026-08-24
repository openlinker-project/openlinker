/**
 * FiscalizationRegisterHandler unit tests (#2156). Mocks
 * `IFiscalRegistrationService`; asserts the validate -> reconstruct ->
 * delegate path, deep-validation business-failure rejection, the
 * never-throws-on-rejection outcome contract, and the retryable vs terminal
 * exception split.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { FiscalizationRegisterHandler, MAX_FISCAL_LINES } from '../fiscalization-register.handler';
import {
  MissingIdempotencyKeyException,
  OrderAlreadyRegisteredException,
  OrderAlreadyHasInvoiceException,
  FiscalRegistrationContendedException,
  MissingFiscalTaxRateException,
} from '@openlinker/core/fiscalization';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { IFiscalRegistrationService } from '@openlinker/core/fiscalization';
import type {
  FiscalizationRegisterPayloadV1,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';

function makePayload(
  overrides: Partial<FiscalizationRegisterPayloadV1> = {},
): FiscalizationRegisterPayloadV1 {
  return {
    schemaVersion: 1,
    connectionId: 'conn-1',
    orderId: 'order-1',
    idempotencyKey: 'fiscal:conn-1:order-1',
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 10, taxRate: '', sku: null }],
    totalGross: 20,
    sourceConnectionId: 'src-1',
    ...overrides,
  };
}

function makeJob(payload: unknown): SyncJobEntity {
  return {
    id: 'job-1',
    jobType: 'fiscalization.register',
    connectionId: 'conn-1',
    payload: payload as Record<string, unknown>,
    idempotencyKey: 'fiscal:conn-1:order-1',
    status: 'running',
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJobEntity;
}

describe('FiscalizationRegisterHandler', () => {
  let fiscalRegistrations: jest.Mocked<IFiscalRegistrationService>;
  let handler: FiscalizationRegisterHandler;
  let warnSpy: jest.SpyInstance<void, [message: string]>;

  beforeEach(() => {
    fiscalRegistrations = {
      register: jest.fn().mockResolvedValue({} as never),
      getByOrderId: jest.fn(),
      getById: jest.fn(),
      reconcileInDoubt: jest.fn(),
    };
    handler = new FiscalizationRegisterHandler(fiscalRegistrations);
    warnSpy = jest
      .spyOn(
        (handler as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined) as jest.SpyInstance<void, [message: string]>;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('happy path (pure delegate)', () => {
    it('validates, reconstructs the command, calls register(command), returns ok', async () => {
      const result = await handler.execute(makeJob(makePayload()));
      expect(result).toEqual({ outcome: 'ok' });
      expect(fiscalRegistrations.register).toHaveBeenCalledTimes(1);
      const cmd = fiscalRegistrations.register.mock.calls[0][0];
      expect(cmd.orderId).toBe('order-1');
      expect(cmd.connectionId).toBe('conn-1');
      expect(cmd.idempotencyKey).toBe('fiscal:conn-1:order-1');
      expect(cmd.totalGross).toBe(20);
    });

    it('restores occurredAt from ISO string to a Date', async () => {
      await handler.execute(
        makeJob(makePayload({ occurredAt: '2026-06-19T14:30:00.000Z' })),
      );
      const cmd = fiscalRegistrations.register.mock.calls[0][0];
      expect(cmd.occurredAt).toBeInstanceOf(Date);
      expect(cmd.occurredAt?.toISOString()).toBe('2026-06-19T14:30:00.000Z');
    });

    it('omits occurredAt entirely when the payload carries none', async () => {
      await handler.execute(makeJob(makePayload()));
      const cmd = fiscalRegistrations.register.mock.calls[0][0];
      expect('occurredAt' in cmd).toBe(false);
    });

    it('carries recipient through when present', async () => {
      await handler.execute(
        makeJob(makePayload({ recipient: { email: 'buyer@example.com', phone: null } })),
      );
      const cmd = fiscalRegistrations.register.mock.calls[0][0];
      expect(cmd.recipient).toEqual({ email: 'buyer@example.com', phone: null });
    });

    it('a resolved register() call is ALWAYS outcome ok, even when the record itself is failed', async () => {
      // register() never throws on a provider rejection — the outcome lives
      // on the returned record, not on whether the promise resolved.
      fiscalRegistrations.register.mockResolvedValue({
        status: 'failed',
        failureMode: 'rejected',
      } as never);
      const result = await handler.execute(makeJob(makePayload()));
      expect(result).toEqual({ outcome: 'ok' });
    });
  });

  describe('deep payload validation ⇒ business_failure', () => {
    const cases: Array<[string, unknown]> = [
      ['wrong schemaVersion', makePayload({ schemaVersion: 2 as unknown as 1 })],
      ['empty lines', makePayload({ lines: [] })],
      [
        'over-bound lines',
        makePayload({
          lines: Array.from({ length: MAX_FISCAL_LINES + 1 }, () => ({
            name: 'x',
            quantity: 1,
            unitPriceGross: 1,
            taxRate: '',
            sku: null,
          })),
        }),
      ],
      [
        'negative unitPriceGross',
        makePayload({
          lines: [{ name: 'x', quantity: 1, unitPriceGross: -1, taxRate: '', sku: null }],
        }),
      ],
      [
        'quantity <= 0',
        makePayload({
          lines: [{ name: 'x', quantity: 0, unitPriceGross: 1, taxRate: '', sku: null }],
        }),
      ],
      ['missing connectionId', makePayload({ connectionId: '' })],
      ['non-finite totalGross', makePayload({ totalGross: Number.NaN })],
      ['present but empty occurredAt', makePayload({ occurredAt: '' })],
      [
        'recipient.email present but non-string, non-null',
        makePayload({ recipient: { email: 42 as unknown as string, phone: null } }),
      ],
    ];

    it.each(cases)('%s ⇒ business_failure (no register call)', async (_label, payload) => {
      const result = await handler.execute(makeJob(payload));
      expect(result).toEqual({ outcome: 'business_failure' });
      expect(fiscalRegistrations.register).not.toHaveBeenCalled();
    });

    it('validation-failure log names only field + orderId/connectionId/schemaVersion', async () => {
      await handler.execute(makeJob(makePayload({ lines: [] })));
      const logged = warnSpy.mock.calls[0][0];
      expect(logged).toContain('field=lines');
      expect(logged).toContain('orderId=order-1');
      expect(logged).toContain('connectionId=conn-1');
    });
  });

  describe('terminal refusals ⇒ business_failure (persisted-state facts)', () => {
    it('OrderAlreadyRegisteredException is terminal', async () => {
      fiscalRegistrations.register.mockRejectedValue(
        new OrderAlreadyRegisteredException('order-1', 'conn-other', 'conn-1', 'registered', 'rec-1'),
      );
      const result = await handler.execute(makeJob(makePayload()));
      expect(result).toEqual({ outcome: 'business_failure' });
    });

    it('OrderAlreadyHasInvoiceException is terminal', async () => {
      fiscalRegistrations.register.mockRejectedValue(
        new OrderAlreadyHasInvoiceException('order-1', 'conn-inv', 'conn-1', 'issued', 'inv-1'),
      );
      const result = await handler.execute(makeJob(makePayload()));
      expect(result).toEqual({ outcome: 'business_failure' });
    });

    it('MissingIdempotencyKeyException is terminal', async () => {
      fiscalRegistrations.register.mockRejectedValue(
        new MissingIdempotencyKeyException('order-1'),
      );
      const result = await handler.execute(makeJob(makePayload()));
      expect(result).toEqual({ outcome: 'business_failure' });
    });

    it('MissingFiscalTaxRateException is terminal, not retried (#2260 review)', async () => {
      // A decision about persisted data, unchanged by a retry. In the retryable
      // catch-all it burned the whole maxAttempts budget with backoff and then
      // landed `dead`, reading as an incident rather than a catalogue gap.
      fiscalRegistrations.register.mockRejectedValue(
        new MissingFiscalTaxRateException('order-1', 1, 2, 'SKU-9'),
      );
      const result = await handler.execute(makeJob(makePayload()));
      expect(result).toEqual({ outcome: 'business_failure' });
    });

    it('the tax-rate refusal log carries counts and ids only, never the line label', async () => {
      fiscalRegistrations.register.mockRejectedValue(
        new MissingFiscalTaxRateException('order-1', 1, 2, 'Jan Kowalski gift set'),
      );
      await handler.execute(makeJob(makePayload()));
      const logged = warnSpy.mock.calls.map((call) => call[0]).join(' | ');
      expect(logged).toContain('order-1');
      expect(logged).toContain('1 of 2');
      expect(logged).not.toContain('Jan Kowalski gift set');
    });
  });

  describe("the order's tax-rate era (#2260 review)", () => {
    it('carries a recognised era onto the command', async () => {
      await handler.execute(makeJob(makePayload({ taxRateEra: 'pre-rollout' })));
      expect(fiscalRegistrations.register).toHaveBeenCalledWith(
        expect.objectContaining({ taxRateEra: 'pre-rollout' }),
      );
    });

    it('drops an unrecognised era rather than exempting the order', async () => {
      await handler.execute(makeJob(makePayload({ taxRateEra: 'legacy' })));
      const command = fiscalRegistrations.register.mock.calls[0]?.[0];
      expect(command && 'taxRateEra' in command).toBe(false);
    });

    it('omits the field for an ordinary order', async () => {
      await handler.execute(makeJob(makePayload()));
      const command = fiscalRegistrations.register.mock.calls[0]?.[0];
      expect(command && 'taxRateEra' in command).toBe(false);
    });
  });

  describe('retryable failures', () => {
    it('FiscalRegistrationContendedException is retryable (wrapped, thrown)', async () => {
      fiscalRegistrations.register.mockRejectedValue(
        new FiscalRegistrationContendedException('order-1'),
      );
      await expect(handler.execute(makeJob(makePayload()))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
    });

    it('a transport error is wrapped in SyncJobExecutionError and THROWN', async () => {
      fiscalRegistrations.register.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(handler.execute(makeJob(makePayload()))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
    });
  });

  it('is defined', () => {
    expect(FiscalizationRegisterHandler).toBeDefined();
  });
});
