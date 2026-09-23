/**
 * Dual-Role Connection Regression Integration Test (#3195)
 *
 * `documentKind: 'both'` (#3195) makes a `Connection` reachable that carries
 * BOTH `Invoicing` and `Fiscalization` enabled at once. Before this issue no
 * connection could ever reach that state in the field — an operator could
 * only ever configure `'invoice'` or `'fiscal-receipt'` on one connection —
 * so the pre-existing cross-kind guard (`InvoiceService.assertNoBlockingFiscalReceipt`
 * / `FiscalRegistrationService.assertNotAlreadyRegistered`'s cross-kind half,
 * #2157/ADR-041 §3a/3b, hardened for the SAME-connection case at #3184/#3218)
 * was unit-tested against a same-connection-id fixture but never proved
 * against a REAL dual-role `Connection` row, REAL Postgres rows and the REAL
 * per-order `SyncLockPort` lock (`invoiceIssueLockKey`) both write paths
 * acquire — none of which a mocked-repository unit spec exercises.
 *
 * This spec does NOT write any new guard logic. It seeds an already-`issued`
 * invoice on order A and an already-`registered` fiscal receipt on order B —
 * both on the SAME dual-role connection — then attempts the OTHER kind on
 * each of those same two orders through the real `InvoiceService.issueInvoice`
 * / `FiscalRegistrationService.register` and asserts both are refused. The
 * guard runs BEFORE any adapter is resolved (see `InvoiceService.issueLocked`
 * step (0) and `FiscalRegistrationService.register`'s own early call), so no
 * capability adapter needs to be registered for this to exercise the real
 * code path end to end.
 *
 * @module apps/api/test/integration/sales-documents
 */
import type { DataSource } from 'typeorm';

import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import {
  INVOICE_SERVICE_TOKEN,
  OrderAlreadyHasFiscalReceiptException,
  BuyerProfile,
} from '@openlinker/core/invoicing';
import type { IInvoiceService, IssueInvoiceCommand } from '@openlinker/core/invoicing';
import { FiscalRegistrationRecordOrmEntity } from '@openlinker/core/fiscalization/orm-entities';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  OrderAlreadyHasInvoiceException,
} from '@openlinker/core/fiscalization';
import type {
  IFiscalRegistrationService,
  RegisterTransactionCommand,
} from '@openlinker/core/fiscalization';

import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';

const TEST_PLATFORM_TYPE = 'dual-role-test';

async function seedIssuedInvoice(
  dataSource: DataSource,
  connectionId: string,
  orderId: string,
): Promise<InvoiceRecordOrmEntity> {
  const repo = dataSource.getRepository(InvoiceRecordOrmEntity);
  const entity = repo.create({
    connectionId,
    orderId,
    providerType: TEST_PLATFORM_TYPE,
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: `INV:${orderId}`,
  });
  return repo.save(entity);
}

async function seedRegisteredFiscalReceipt(
  dataSource: DataSource,
  connectionId: string,
  orderId: string,
): Promise<FiscalRegistrationRecordOrmEntity> {
  const repo = dataSource.getRepository(FiscalRegistrationRecordOrmEntity);
  const entity = repo.create({
    connectionId,
    orderId,
    providerType: TEST_PLATFORM_TYPE,
    idempotencyKey: `fiscal:${connectionId}:${orderId}`,
    status: 'registered',
  });
  return repo.save(entity);
}

function makeInvoiceCommand(overrides: Partial<IssueInvoiceCommand>): IssueInvoiceCommand {
  return {
    connectionId: overrides.connectionId ?? '',
    orderId: overrides.orderId ?? '',
    buyer: new BuyerProfile(
      'Jan Kowalski',
      null,
      { line1: 'ul. Testowa 1', line2: null, city: 'Poznań', postalCode: '60-001', countryIso2: 'PL' },
      'private',
    ),
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 12.3, taxRate: '23' }],
    ...overrides,
  };
}

function makeFiscalCommand(
  overrides: Partial<RegisterTransactionCommand>,
): RegisterTransactionCommand {
  return {
    connectionId: overrides.connectionId ?? '',
    orderId: overrides.orderId ?? '',
    idempotencyKey:
      overrides.idempotencyKey ?? `fiscal:${overrides.connectionId ?? ''}:${overrides.orderId ?? ''}`,
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '23', sku: null }],
    totalGross: 10,
    ...overrides,
  };
}

describe('Dual-role connection cross-kind guard regression (#3195)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let invoiceService: IInvoiceService;
  let fiscalRegistrationService: IFiscalRegistrationService;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    invoiceService = harness.getApp().get<IInvoiceService>(INVOICE_SERVICE_TOKEN);
    fiscalRegistrationService = harness
      .getApp()
      .get<IFiscalRegistrationService>(FISCAL_REGISTRATION_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('refuses an invoice on an order that already has a fiscal receipt, and a fiscal receipt on an order that already has an invoice — both through the SAME dual-role connection', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: TEST_PLATFORM_TYPE,
      adapterKey: 'dual-role.test.v1',
      // A single connection carrying BOTH capabilities — the state #3195
      // makes reachable via `documentKind: 'both'`.
      enabledCapabilities: ['Invoicing', 'Fiscalization'],
      config: { salesDocument: { documentKind: 'both' } },
    });

    const orderA = 'ol_order_3195_a';
    const orderB = 'ol_order_3195_b';

    // Order A already has a fiscal receipt; order B already has an invoice —
    // both on the SAME dual-role connection.
    const fiscalRecord = await seedRegisteredFiscalReceipt(dataSource, connection.id, orderA);
    const invoiceRecord = await seedIssuedInvoice(dataSource, connection.id, orderB);

    // Attempting to issue an INVOICE on order A (already a fiscal receipt)
    // through the SAME connection is refused — the guard is connection-BLIND
    // (#3184/#3218): "same connection id" must never be read as "this is my
    // own retry", or a dual-role connection could issue both kinds for one
    // order.
    const invoiceOnA = await invoiceService
      .issueInvoice(
        makeInvoiceCommand({
          connectionId: connection.id,
          orderId: orderA,
          idempotencyKey: `idem-3195-${orderA}`,
        }),
      )
      .catch((error: unknown) => error);
    expect(invoiceOnA).toBeInstanceOf(OrderAlreadyHasFiscalReceiptException);
    const invoiceOnAError = invoiceOnA as OrderAlreadyHasFiscalReceiptException;
    expect(invoiceOnAError.registeringConnectionId).toBe(connection.id);
    expect(invoiceOnAError.requestedConnectionId).toBe(connection.id);
    expect(invoiceOnAError.blockingRecordId).toBe(fiscalRecord.id);

    // Attempting to register a FISCAL RECEIPT on order B (already an
    // invoice) through the SAME connection is likewise refused.
    const fiscalOnB = await fiscalRegistrationService
      .register(
        makeFiscalCommand({
          connectionId: connection.id,
          orderId: orderB,
          idempotencyKey: `fiscal:3195:${orderB}`,
        }),
      )
      .catch((error: unknown) => error);
    expect(fiscalOnB).toBeInstanceOf(OrderAlreadyHasInvoiceException);
    const fiscalOnBError = fiscalOnB as OrderAlreadyHasInvoiceException;
    expect(fiscalOnBError.invoicingConnectionId).toBe(connection.id);
    expect(fiscalOnBError.requestedConnectionId).toBe(connection.id);
    expect(fiscalOnBError.blockingInvoiceId).toBe(invoiceRecord.id);

    // No second record was created on either order for the refused kind.
    const fiscalRecordsForA = await fiscalRegistrationService.getByOrderId(orderA);
    expect(fiscalRecordsForA).toHaveLength(1);
    const invoiceIdsForB = await invoiceService.listInvoiceConnectionIdsForOrder(orderB);
    expect(invoiceIdsForB).toEqual([connection.id]);
  });
});
