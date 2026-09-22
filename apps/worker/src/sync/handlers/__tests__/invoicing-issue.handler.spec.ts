/**
 * InvoicingIssueHandler unit tests (OL #1120). Mocks `IInvoiceService`; asserts
 * the validate -> reconstruct -> delegate path, F5 business-failure rejection,
 * PII discipline on failure logs, and retryable transport wrapping.
 *
 * The `buyer.taxId (#3224)` block below was added after a real defect: the
 * spec HAD coverage of `buyer.taxId` (the `half-populated taxId` row in the F5
 * table) but none of an UNTAGGED one, so when #3224 made `scheme` optional in
 * core the worker kept requiring it and every auto-issued B2B invoice was
 * rejected as a terminal `business_failure`. Both halves type-checked, so
 * neither lint nor type-check could have caught it.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { InvoicingIssueHandler, MAX_INVOICE_LINES } from '../invoicing-issue.handler';
import { BuyerProfile } from '@openlinker/core/invoicing';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type { PostSaleInventoryRefreshService } from '@openlinker/core/inventory';
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
  let postSaleInventoryRefresh: jest.Mocked<PostSaleInventoryRefreshService>;
  let warnSpy: jest.SpyInstance<void, [message: string]>;

  beforeEach(() => {
    invoiceService = {
      issueInvoice: jest.fn().mockResolvedValue({ id: 'inv-record-1' } as never),
      getInvoice: jest.fn(),
      getInvoiceById: jest.fn(),
      getLatestInvoiceForOrder: jest.fn(),
      listRecentByConnectionId: jest.fn(),
      // #2374 — the correction-proposal read.
      getLatestIssuedInvoiceForOrder: jest.fn().mockResolvedValue(null),
      getInFlightIssuance: jest.fn().mockResolvedValue(null),
      findBlockingInvoiceForOrder: jest.fn().mockResolvedValue(null),
      listInvoiceConnectionIdsForOrder: jest.fn().mockResolvedValue([]),
      getLatestInvoicesForOrders: jest.fn(),
      listInvoicesForOrders: jest.fn().mockResolvedValue([]),
      listInvoices: jest.fn(),
      issueCorrection: jest.fn(),
      applyRegulatoryClearance: jest.fn(),
      listInvoicesKeyset: jest.fn(),
    };
    postSaleInventoryRefresh = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PostSaleInventoryRefreshService>;
    handler = new InvoicingIssueHandler(
      invoiceService as unknown as IInvoiceService,
      postSaleInventoryRefresh,
    );
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

    it('command saleDate is restored from payload.saleDate (#1525)', async () => {
      await handler.execute(makeJob(makePayload({ saleDate: '2026-06-19' })));
      expect(invoiceService.issueInvoice.mock.calls[0][0].saleDate).toBe('2026-06-19');
    });

    it('command omits saleDate when the payload carries none', async () => {
      await handler.execute(makeJob(makePayload()));
      const cmd = invoiceService.issueInvoice.mock.calls[0][0];
      expect('saleDate' in cmd).toBe(false);
    });
  });

  describe('buyer.email (#1797)', () => {
    it('reconstructs BuyerProfile.email from payload.buyer.email', async () => {
      await handler.execute(
        makeJob(
          makePayload({
            buyer: { ...makePayload().buyer, email: 'buyer@example.com' },
          }),
        ),
      );
      const cmd = invoiceService.issueInvoice.mock.calls[0][0];
      expect(cmd.buyer.email).toBe('buyer@example.com');
    });

    it('normalizes a missing buyer.email (pre-#1797 payload shape) to null', async () => {
      const payload = makePayload();
      // Simulate a job persisted before this field existed: no `email` key at all.
      delete (payload.buyer as { email?: string | null }).email;

      const result = await handler.execute(makeJob(payload));

      expect(result).toEqual({ outcome: 'ok' });
      expect(invoiceService.issueInvoice.mock.calls[0][0].buyer.email).toBeNull();
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
      ['present but non-string, non-null buyer.email (#1797)', makePayload({
        buyer: { ...makePayload().buyer, email: 42 as unknown as string },
      })],
      ['missing connectionId', makePayload({ connectionId: '' })],
      ['present but empty saleDate', makePayload({ saleDate: '' })],
      ['present but non-string saleDate', makePayload({ saleDate: 5 as unknown as string })],
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

  describe('buyer.taxId (#3224)', () => {
    function withTaxId(taxId: unknown): SyncJobEntity {
      const base = makePayload();
      return makeJob({ ...base, buyer: { ...base.buyer, taxId } });
    }

    // The regression. An untagged number is what core SENDS since #3224
    // (ADR-073 decision 1 - tagging it would make `libs/core` name a country's
    // identifier system), so rejecting it here means the epic's flagship fix
    // issues nothing at all.
    it('accepts an UNTAGGED tax id and issues the invoice', async () => {
      const result = await handler.execute(withTaxId({ value: '5213796333' }));

      expect(result.outcome).toBe('ok');
      expect(invoiceService.issueInvoice).toHaveBeenCalledTimes(1);
    });

    it('still accepts a tagged tax id, so an adapter-tagged payload is unaffected', async () => {
      const result = await handler.execute(
        withTaxId({ scheme: 'pl-nip', value: '5213796333' }),
      );

      expect(result.outcome).toBe('ok');
    });

    // Absent and malformed stay different: a present tag of the wrong TYPE is
    // a defect in whoever built the payload, and letting it through would hand
    // the adapter something it cannot place while looking deliberate.
    it('refuses a present-but-wrong-typed scheme as a terminal business failure', async () => {
      const result = await handler.execute(
        withTaxId({ scheme: 42, value: '5213796333' }),
      );

      expect(result.outcome).toBe('business_failure');
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain('buyer.taxId.scheme');
    });

    it('refuses a tax id carrying no value', async () => {
      const result = await handler.execute(withTaxId({ scheme: 'pl-nip' }));

      expect(result.outcome).toBe('business_failure');
      expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
    });
  });

  it('is defined', () => {
    expect(InvoicingIssueHandler).toBeDefined();
  });
});
