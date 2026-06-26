/**
 * Invoicing list integration test (#1119)
 *
 * Seeds `InvoiceRecordOrmEntity` rows and exercises GET /invoices per AC-6
 * filter (status / connection / regulatory / issued date-range) + pagination
 * against Testcontainers Postgres, asserting the response items omit
 * `errorMessage` + `idempotencyKey`. Requires Docker — run via
 * `pnpm test:integration` on a Docker host; absence must NOT fail the unit gate.
 *
 * Reads go through the HTTP surface (GET /invoices) and the orders/invoice
 * service seams — no repository-port import (so no cross-context allow-list
 * entry is needed). Seeding writes the ORM entity directly via the DataSource
 * (the `/orm-entities` sub-barrel is the sanctioned test seed surface).
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import type { DataSource } from 'typeorm';

const CONN_A = '11111111-1111-4111-8111-111111111111';
const CONN_B = '22222222-2222-4222-8222-222222222222';
// Distinct invoicing connection — deliberately different from the order's
// source/marketplace connection, to prove the GET keys off the invoicing
// connection (the one the invoice was issued on), not the order source.
const INVOICING_CONN = '33333333-3333-4333-8333-333333333333';
const SOURCE_CONN = '44444444-4444-4444-8444-444444444444';

interface SeedOverrides {
  connectionId?: string;
  orderId?: string;
  status?: 'pending' | 'issued' | 'failed';
  regulatoryStatus?: 'not-applicable' | 'submitted' | 'cleared' | 'accepted' | 'rejected';
  issuedAt?: Date | null;
  idempotencyKey?: string | null;
  errorMessage?: string | null;
}

async function seedInvoice(ds: DataSource, overrides: SeedOverrides = {}): Promise<string> {
  const repo = ds.getRepository(InvoiceRecordOrmEntity);
  const entity = repo.create({
    connectionId: overrides.connectionId ?? CONN_A,
    orderId: overrides.orderId ?? `ol_order_${Math.random().toString(36).slice(2, 8)}`,
    providerType: 'subiekt',
    documentType: 'invoice',
    status: overrides.status ?? 'issued',
    providerInvoiceId: null,
    providerInvoiceNumber: null,
    regulatoryStatus: overrides.regulatoryStatus ?? 'not-applicable',
    clearanceReference: null,
    idempotencyKey: overrides.idempotencyKey ?? null,
    pdfUrl: null,
    issuedAt: overrides.issuedAt ?? null,
    errorMessage: overrides.errorMessage ?? null,
  });
  const saved = await repo.save(entity);
  return saved.id;
}

describe('Invoicing list (integration)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('boots and exposes an authenticated GET /invoices', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const response = await http
      .get('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({ items: expect.any(Array), total: 0, limit: 20, offset: 0 }),
    );
  });

  it('rejects an unauthenticated request', async () => {
    const http = harness.getHttp();
    await http.get('/invoices').expect(401);
  });

  it('filters by status', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);
    await seedInvoice(ds, { status: 'issued' });
    await seedInvoice(ds, { status: 'failed' });
    await seedInvoice(ds, { status: 'pending' });

    const response = await http
      .get('/invoices?status=failed')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].status).toBe('failed');
  });

  it('filters by connectionId', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);
    await seedInvoice(ds, { connectionId: CONN_A });
    await seedInvoice(ds, { connectionId: CONN_A });
    await seedInvoice(ds, { connectionId: CONN_B });

    const response = await http
      .get(`/invoices?connectionId=${CONN_B}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].connectionId).toBe(CONN_B);
  });

  it('filters by regulatoryStatus', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);
    await seedInvoice(ds, { regulatoryStatus: 'cleared' });
    await seedInvoice(ds, { regulatoryStatus: 'not-applicable' });

    const response = await http
      .get('/invoices?regulatoryStatus=cleared')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].regulatoryStatus).toBe('cleared');
  });

  it('filters by issued date range (issuedFrom/issuedTo, inclusive)', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);
    await seedInvoice(ds, { issuedAt: new Date('2026-05-15T00:00:00.000Z') });
    const inWindow = await seedInvoice(ds, { issuedAt: new Date('2026-06-15T00:00:00.000Z') });
    await seedInvoice(ds, { issuedAt: new Date('2026-07-15T00:00:00.000Z') });

    const response = await http
      .get('/invoices?issuedFrom=2026-06-01T00:00:00.000Z&issuedTo=2026-06-30T00:00:00.000Z')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].id).toBe(inWindow);
  });

  it('paginates with limit/offset and returns { items, total, limit, offset }', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);
    for (let i = 0; i < 3; i++) {
      await seedInvoice(ds, { connectionId: CONN_A });
    }

    const response = await http
      .get('/invoices?limit=2&offset=0')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.total).toBe(3);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.limit).toBe(2);
    expect(response.body.offset).toBe(0);

    const page2 = await http
      .get('/invoices?limit=2&offset=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
  });

  it('response items omit errorMessage and idempotencyKey', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);
    await seedInvoice(ds, {
      idempotencyKey: 'secret-key',
      errorMessage: 'internal diagnostic with PII',
    });

    const response = await http
      .get('/invoices')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).not.toHaveProperty('errorMessage');
    expect(response.body.items[0]).not.toHaveProperty('idempotencyKey');
  });

  it('rejects an unknown tax-id filter (AC-6 sub-filter deferred — not in the contract)', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);
    await seedInvoice(ds);

    // `hasTaxId` is DELIBERATELY not part of the GET /invoices contract (no
    // backing column; #1119 follow-up). With `forbidNonWhitelisted`, the boundary
    // rejects it with a 400 rather than accepting-and-ignoring it (which would
    // mislead a caller into thinking results were filtered).
    await http
      .get('/invoices?hasTaxId=true')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});

describe('GET /orders/:orderId/invoice (integration)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('resolves the invoice by the supplied invoicing connectionId, NOT the order sourceConnectionId', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);

    // The order was ingested on SOURCE_CONN (marketplace) but the invoice was
    // issued on INVOICING_CONN — the realistic case where the two capabilities
    // live on different connections. Deriving the lookup key from the order's
    // sourceConnectionId would 404; the GET must use the query param instead.
    const order = await createTestOrderRecord(ds, { sourceConnectionId: SOURCE_CONN });
    await seedInvoice(ds, {
      connectionId: INVOICING_CONN,
      orderId: order.internalOrderId,
      status: 'issued',
    });

    const found = await http
      .get(`/orders/${order.internalOrderId}/invoice?connectionId=${INVOICING_CONN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(found.body.orderId).toBe(order.internalOrderId);
    expect(found.body.connectionId).toBe(INVOICING_CONN);

    // Keying off the (wrong) source connection finds nothing.
    await http
      .get(`/orders/${order.internalOrderId}/invoice?connectionId=${SOURCE_CONN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('requires the connectionId query param (400 when absent)', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);
    const order = await createTestOrderRecord(ds, { sourceConnectionId: SOURCE_CONN });

    await http
      .get(`/orders/${order.internalOrderId}/invoice`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('404 when the order does not exist', async () => {
    const http = harness.getHttp();
    const ds = harness.getDataSource();
    const token = await loginAsAdmin(http, ds);

    await http
      .get(`/orders/ol_order_missing/invoice?connectionId=${INVOICING_CONN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
