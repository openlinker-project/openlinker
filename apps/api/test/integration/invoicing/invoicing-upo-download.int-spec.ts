/**
 * Invoicing UPO Download Endpoint Integration Test (#1224, epic #1142 C15)
 *
 * Vertical slice over `GET /invoices/:invoiceId/upo`: real HTTP → JwtAuthGuard +
 * RolesGuard → InvoicingController → InvoiceRecordRepository (real Postgres) →
 * Invoicing capability adapter (resolved through the live IntegrationsService
 * registry). A test-only `Invoicing` adapter is registered against the running
 * app's `AdapterRegistryService` / `AdapterFactoryResolverService` so the
 * cleared-record path streams real bytes without reaching a live KSeF endpoint —
 * the same production resolution path real adapters use.
 *
 * Covers: 200 (bytes + Content-Type/Content-Disposition headers) for a cleared
 * record, 404 for an unknown id, 409 for a not-yet-cleared record, 403 for a
 * non-admin caller.
 *
 * NOTE: this worktree's node_modules can symlink to a stale core dist, which
 * breaks api controller specs locally — this spec is written to run in CI where
 * the workspace is freshly built.
 *
 * @module apps/api/test/integration/invoicing
 */
import * as bcrypt from 'bcryptjs';
import type { DataSource } from 'typeorm';

import type {
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import type {
  InvoicingPort,
  RegulatoryDocument,
  RegulatoryDocumentReader,
} from '@openlinker/core/invoicing';

import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';
import { createTestConnection } from '../helpers/test-connection.helper';

const TEST_ADAPTER_KEY = 'invoicing.test.v1';
const TEST_PLATFORM_TYPE = 'invoicing-test';
const UPO_BYTES = new Uint8Array([60, 85, 80, 79, 62]); // "<UPO>"

/** Stub Invoicing adapter implementing the RegulatoryDocumentReader sub-capability. */
class StubInvoicingAdapter implements InvoicingPort, RegulatoryDocumentReader {
  issueInvoice = jest.fn();
  getInvoice = jest.fn();
  upsertCustomer = jest.fn();
  getSupportedDocumentTypes = jest.fn().mockReturnValue([]);

  getRegulatoryDocument(): Promise<RegulatoryDocument> {
    return Promise.resolve({ content: UPO_BYTES, contentType: 'application/xml' });
  }
}

function installInvoicingAdapter(harness: IntegrationTestHarness): void {
  const app = harness.getApp();
  const adapterRegistry = app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = app.get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  adapterRegistry.register({
    adapterKey: TEST_ADAPTER_KEY,
    platformType: TEST_PLATFORM_TYPE,
    supportedCapabilities: ['Invoicing'],
    displayName: 'Invoicing (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });

  factoryResolver.registerFactory(TEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> =>
      Promise.resolve(new StubInvoicingAdapter() as unknown as T),
  });
}

async function loginAsViewer(harness: IntegrationTestHarness): Promise<string> {
  const passwordHash = await bcrypt.hash('viewer-pass', 4);
  await harness
    .getDataSource()
    .query(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'viewer')`, [
      'viewer',
      'viewer@example.com',
      passwordHash,
    ]);
  const response = await harness
    .getHttp()
    .post('/auth/login')
    .send({ username: 'viewer', password: 'viewer-pass' })
    .expect(200);
  return (response.body as { access_token: string }).access_token;
}

async function seedInvoiceRecord(
  dataSource: DataSource,
  overrides: Partial<InvoiceRecordOrmEntity>,
): Promise<InvoiceRecordOrmEntity> {
  const repo = dataSource.getRepository(InvoiceRecordOrmEntity);
  const entity = repo.create({
    connectionId: overrides.connectionId,
    orderId: overrides.orderId ?? 'ol_order_upo_int',
    providerType: 'invoicing-test',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'SESSION:INVOICE',
    regulatoryStatus: 'accepted',
    clearanceReference: '5265877635-20250826-0100001AF629-AF',
    ...overrides,
  });
  return repo.save(entity);
}

describe('Invoicing UPO Download Integration (#1224)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
    installInvoicingAdapter(harness);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should stream UPO bytes with provider Content-Type for a cleared invoice (200)', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);
    const connection = await createTestConnection(dataSource, {
      platformType: TEST_PLATFORM_TYPE,
      adapterKey: TEST_ADAPTER_KEY,
      enabledCapabilities: ['Invoicing'],
    });
    const record = await seedInvoiceRecord(dataSource, { connectionId: connection.id });

    const res = await http
      .get(`/invoices/${record.id}/upo`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.headers['content-disposition']).toContain(`ol-upo-${record.id}.xml`);
    expect(res.body as Buffer).toEqual(Buffer.from(UPO_BYTES));
  });

  it('should 404 when the invoice id is unknown', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    await http
      .get('/invoices/11111111-1111-1111-1111-111111111111/upo')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('should 409 when the invoice is not yet cleared', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);
    const connection = await createTestConnection(dataSource, {
      platformType: TEST_PLATFORM_TYPE,
      adapterKey: TEST_ADAPTER_KEY,
      enabledCapabilities: ['Invoicing'],
    });
    const record = await seedInvoiceRecord(dataSource, {
      connectionId: connection.id,
      regulatoryStatus: 'submitted',
      clearanceReference: null,
    });

    await http
      .get(`/invoices/${record.id}/upo`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('should 403 for a non-admin caller', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: TEST_PLATFORM_TYPE,
      adapterKey: TEST_ADAPTER_KEY,
      enabledCapabilities: ['Invoicing'],
    });
    const record = await seedInvoiceRecord(dataSource, { connectionId: connection.id });
    const viewerToken = await loginAsViewer(harness);

    await http
      .get(`/invoices/${record.id}/upo`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });
});
