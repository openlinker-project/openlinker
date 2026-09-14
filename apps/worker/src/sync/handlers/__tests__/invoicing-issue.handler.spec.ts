/**
 * InvoicingIssueHandler payload-validation tests (#3224 review, blocking finding)
 *
 * The handler had NO spec, which is why this shipped: #3224 made
 * `TaxIdentifier.scheme` optional so core hands the buyer's tax number over
 * untagged, and the worker's deep payload validation still REQUIRED the tag -
 * so every auto-issued B2B invoice was rejected as a terminal
 * `business_failure` and no document was produced at all. That is strictly
 * worse than the untagged-but-issued invoice the epic exists to send, and no
 * lint or type-check could have caught it: both halves type-check perfectly.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { InvoicingIssueHandler } from '../invoicing-issue.handler';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type { InvoicingIssuePayloadV1, SyncJob as SyncJobEntity } from '@openlinker/core/sync';

function makePayload(buyerTaxId: unknown): InvoicingIssuePayloadV1 {
  return {
    schemaVersion: 1,
    connectionId: 'conn-1',
    orderId: 'ol_order_1',
    idempotencyKey: 'invoice:conn-1:ol_order_1',
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 10, taxRate: '23' }],
    buyer: {
      name: 'ACME sp. z o.o.',
      taxId: buyerTaxId as never,
      address: {
        line1: 'ul. Testowa 1',
        line2: null,
        city: 'Warszawa',
        postalCode: '00-001',
        countryIso2: 'PL',
      },
      type: 'company',
    },
    sourceConnectionId: 'src-1',
    trigger: 'auto-on-paid',
  } as InvoicingIssuePayloadV1;
}

function makeJob(payload: unknown): SyncJobEntity {
  return {
    id: 'job-1',
    jobType: 'invoicing.issue',
    connectionId: 'conn-1',
    payload: payload as Record<string, unknown>,
    idempotencyKey: 'invoice:conn-1:ol_order_1',
    status: 'running',
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJobEntity;
}

describe('InvoicingIssueHandler payload validation', () => {
  let invoiceService: jest.Mocked<IInvoiceService>;
  let handler: InvoicingIssueHandler;

  beforeEach(() => {
    invoiceService = {
      issueInvoice: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<IInvoiceService>;
    handler = new InvoicingIssueHandler(invoiceService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The blocking regression. An untagged number is what core SENDS since
  // #3224, so rejecting it here means the epic's flagship fix issues nothing.
  it('accepts an UNTAGGED buyer tax id and issues the invoice (#3224)', async () => {
    const result = await handler.execute(makeJob(makePayload({ value: '5213796333' })));

    expect(result.outcome).toBe('ok');
    expect(invoiceService.issueInvoice).toHaveBeenCalledTimes(1);
  });

  it('still accepts a tagged tax id, so an adapter-tagged payload is unaffected', async () => {
    const result = await handler.execute(
      makeJob(makePayload({ scheme: 'pl-nip', value: '5213796333' })),
    );

    expect(result.outcome).toBe('ok');
  });

  it('still accepts a B2C payload carrying no tax id at all', async () => {
    const result = await handler.execute(makeJob(makePayload(null)));

    expect(result.outcome).toBe('ok');
  });

  // Absent and malformed stay different: a present tag of the wrong TYPE is a
  // defect in whoever built the payload, and letting it through would hand the
  // adapter something it cannot place while looking like a deliberate choice.
  //
  // A whitespace-only scheme is deliberately NOT refused here: `isNonEmptyString`
  // does not trim, and every other field in this validator is equally loose, so
  // tightening one of them would be an inconsistency rather than a fix.
  it('refuses a present-but-wrong-typed scheme as a terminal business failure', async () => {
    const result = await handler.execute(
      makeJob(makePayload({ scheme: 42, value: '5213796333' })),
    );

    expect(result.outcome).toBe('business_failure');
    expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
  });

  it('refuses a tax id carrying no value', async () => {
    const result = await handler.execute(makeJob(makePayload({ scheme: 'pl-nip' })));

    expect(result.outcome).toBe('business_failure');
    expect(invoiceService.issueInvoice).not.toHaveBeenCalled();
  });
});
