/**
 * InvoicingIssueHandler unit tests (OL #1120). Mocks `IInvoiceService`; asserts
 * the validate -> reconstruct -> delegate path, F5 business-failure rejection,
 * PII discipline on failure logs, and retryable transport wrapping.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { InvoicingIssueHandler, MAX_INVOICE_LINES } from '../invoicing-issue.handler';
import { BuyerProfile } from '@openlinker/core/invoicing';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type {
  InvoicingIssuePayloadV1,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';

const BUYER_SENTINEL = 'Jan Kowalski';

function makePayload(overrides: Partial<InvoicingIssuePayloadV1> = {}): InvoicingIssuePayloadV1 {
  return {
    schemaVersion: 1,
    connectionId: 'conn-1',
    orderId: 'order-1',
    idempotencyKey: 'invoice:conn-1:order-1',
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 10, taxRate: '' }],
    buyer: {
      name: BUYER_SENTINEL,
      taxId: null,
      address: {
        line1: 'ul. Testowa 1',
        line2: null,
        city: 'Poznań',
        postalCode: '60-001',
        countryIso2: 'PL',
      },
      type: 'private',
    },
    sourceConnectionId: 'src-1',
    trigger: 'auto-on-paid',
    ...overrides,
  };
}

function makeJob(payload: unknown): SyncJobEntity {
  return {
    id: 'job-1',
    jobType: 'invoicing.issue',
    connectionId: 'conn-1',
    payload: payload as Record<string, unknown>,
    idempotencyKey: 'invoice:conn-1:order-1',
    status: 'running',
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJobEntity;
}

describe('InvoicingIssueHandler', () => {
  let invoiceService: jest.Mocked<IInvoiceService>;
  let handler: InvoicingIssueHandler;
  let warnSpy: jest.SpyInstance<void, [message: string]>;

  beforeEach(() => {
    invoiceService = {
      issueInvoice: jest.fn().mockResolvedValue({} as never),
      getInvoice: jest.fn(),
      getInvoiceById: jest.fn(),
      getLatestInvoiceForOrder: jest.fn(),
      listInvoices: jest.fn(),
      issueCorrection: jest.fn(),
    };
    handler = new InvoicingIssueHandler(invoiceService as unknown as IInvoiceService);
    warnSpy = jest
      .spyOn(
        (handler as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined) as jest.SpyInstance<void, [message: string]>;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('happy path (pure delegate)', () => {
    it('validates, reconstructs BuyerProfile, calls issueInvoice(command), returns ok', async () => {
      const result = await handler.execute(makeJob(makePayload()));
      expect(result).toEqual({ outcome: 'ok' });
      expect(invoiceService.issueInvoice).toHaveBeenCalledTimes(1);
      const cmd = invoiceService.issueInvoice.mock.calls[0][0];
      expect(cmd.buyer).toBeInstanceOf(BuyerProfile);
      expect(cmd.buyer.name).toBe(BUYER_SENTINEL);
    });

    it('command idempotencyKey equals payload.idempotencyKey (F4)', async () => {
      await handler.execute(makeJob(makePayload({ idempotencyKey: 'invoice:c:o' })));
      expect(invoiceService.issueInvoice.mock.calls[0][0].idempotencyKey).toBe('invoice:c:o');
    });
  });

  describe('deep payload validation ⇒ business_failure (F5)', () => {
    const cases: Array<[string, unknown]> = [
      ['wrong schemaVersion', makePayload({ schemaVersion: 2 as unknown as 1 })],
      ['empty lines', makePayload({ lines: [] })],
      ['over-bound lines', makePayload({
        lines: Array.from({ length: MAX_INVOICE_LINES + 1 }, () => ({
          name: 'x', quantity: 1, unitPriceGross: 1, taxRate: '',
        })),
      })],
      ['negative unitPriceGross', makePayload({
        lines: [{ name: 'x', quantity: 1, unitPriceGross: -1, taxRate: '' }],
      })],
      ['quantity <= 0', makePayload({
        lines: [{ name: 'x', quantity: 0, unitPriceGross: 1, taxRate: '' }],
      })],
      ['buyer.type not in BuyerTypeValues', makePayload({
        buyer: { ...makePayload().buyer, type: 'enterprise' as never },
      })],
      ['half-populated taxId', makePayload({
        buyer: { ...makePayload().buyer, taxId: { scheme: 'pl-nip', value: '' } },
      })],
      ['missing connectionId', makePayload({ connectionId: '' })],
    ];

    it.each(cases)('%s ⇒ business_failure (no issueInvoice call)', async (_label, payload) => {
      const result = await handler.execute(makeJob(payload));
      expect(result).toEqual({ outcome: 'business_failure' });
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });
  });

  describe('PII discipline on failure paths (F-validate-PII / D11)', () => {
    it('validation-failure log omits buyer.name; names only field + orderId/connectionId/schemaVersion', async () => {
      await handler.execute(makeJob(makePayload({ lines: [] })));
      const logged = warnSpy.mock.calls[0][0];
      expect(logged).not.toContain(BUYER_SENTINEL);
      expect(logged).toContain('field=lines');
      expect(logged).toContain('orderId=order-1');
      expect(logged).toContain('connectionId=conn-1');
    });

    it('validation failure is NOT a thrown error carrying JSON.stringify(job.payload)', async () => {
      await expect(handler.execute(makeJob(makePayload({ lines: [] })))).resolves.toEqual({
        outcome: 'business_failure',
      });
    });

    it('transport-error SyncJobExecutionError message excludes the buyer sentinel and the stringified payload', async () => {
      invoiceService.issueInvoice.mockRejectedValue(new Error(`failed buyer ${BUYER_SENTINEL}`));
      await expect(handler.execute(makeJob(makePayload()))).rejects.toMatchObject({
        name: 'SyncJobExecutionError',
      });
      try {
        await handler.execute(makeJob(makePayload()));
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain(BUYER_SENTINEL);
        expect(msg).not.toContain('ul. Testowa');
      }
    });
  });

  describe('transport / bridge-unreachable (retryable)', () => {
    it('a transport error from issueInvoice is wrapped in SyncJobExecutionError and THROWN', async () => {
      invoiceService.issueInvoice.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(handler.execute(makeJob(makePayload()))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
    });
  });

  it('is defined', () => {
    expect(InvoicingIssueHandler).toBeDefined();
  });
});
