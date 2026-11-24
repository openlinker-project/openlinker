/**
 * Invoicing Attachment Endpoint Integration Test (#3548)
 *
 * Vertical slice over `GET /invoices/:invoiceId/attachment`: real HTTP →
 * JwtAuthGuard + RolesGuard → InvoicingController → InvoiceAttachmentService
 * (resolved through `INVOICE_ATTACHMENT_SERVICE_TOKEN`) → InvoiceRecordRepository
 * (real Postgres) → Invoicing capability adapter resolved through the live
 * IntegrationsService registry. The unit specs cover the provider matrix; this
 * one exists to prove the DI wiring and the route answer against a real record.
 *
 * Two test-only `Invoicing` adapters are registered: one that declares a
 * `rendered` document (the `pdf` answer) and one that declares nothing (so a
 * stored `pdfUrl` is the only source, the `link` answer).
 *
 * @module apps/api/test/integration/invoicing
 */
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
  RegulatoryDocumentKind,
  RegulatoryDocumentReader,
} from '@openlinker/core/invoicing';

import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';
import { createTestConnection } from '../helpers/test-connection.helper';

const RENDERING_ADAPTER_KEY = 'invoicing.attachment-pdf.test.v1';
const RENDERING_PLATFORM_TYPE = 'invoicing-attachment-pdf-test';
const PLAIN_ADAPTER_KEY = 'invoicing.attachment-plain.test.v1';
const PLAIN_PLATFORM_TYPE = 'invoicing-attachment-plain-test';

class PlainInvoicingAdapter implements InvoicingPort {
  issueInvoice = jest.fn();
  getInvoice = jest.fn();
  upsertCustomer = jest.fn();
  getSupportedDocumentTypes = jest.fn().mockReturnValue([]);
}

class RenderingInvoicingAdapter extends PlainInvoicingAdapter implements RegulatoryDocumentReader {
  supportedRegulatoryDocumentKinds(): readonly RegulatoryDocumentKind[] {
    return ['rendered'];
  }

  getRegulatoryDocument(): Promise<RegulatoryDocument> {
    return Promise.resolve({
      content: new Uint8Array([37, 80, 68, 70]),
      contentType: 'application/pdf',
    });
  }
}

function registerAdapter(
  harness: IntegrationTestHarness,
  adapterKey: string,
  platformType: string,
  build: () => InvoicingPort
): void {
  const app = harness.getApp();
  app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN).register({
    adapterKey,
    platformType,
    supportedCapabilities: ['Invoicing'],
    displayName: `${platformType} (integration-test stub)`,
    version: '0.0.0-test',
    isDefault: false,
  });
  app
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN)
    .registerFactory(adapterKey, {
      createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(build() as unknown as T),
    });
}

async function seedInvoiceRecord(
  dataSource: DataSource,
  overrides: Partial<InvoiceRecordOrmEntity>
): Promise<InvoiceRecordOrmEntity> {
  const repo = dataSource.getRepository(InvoiceRecordOrmEntity);
  return repo.save(
    repo.create({
      orderId: 'ol_order_attachment_int',
      providerType: 'invoicing-test',
      documentType: 'invoice',
      status: 'issued',
      providerInvoiceId: 'PROVIDER-1',
      regulatoryStatus: 'accepted',
      clearanceReference: '5265877635-20250826-0100001AF629-AF',
      ...overrides,
    })
  );
}

describe('Invoicing Attachment Integration (#3548)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
    registerAdapter(
      harness,
      RENDERING_ADAPTER_KEY,
      RENDERING_PLATFORM_TYPE,
      () => new RenderingInvoicingAdapter()
    );
    registerAdapter(
      harness,
      PLAIN_ADAPTER_KEY,
      PLAIN_PLATFORM_TYPE,
      () => new PlainInvoicingAdapter()
    );
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function connectionFor(adapterKey: string, platformType: string): Promise<string> {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType,
      adapterKey,
      enabledCapabilities: ['Invoicing'],
    });
    return connection.id;
  }

  it('should answer pdf with the download route when the provider declares a rendered document', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const record = await seedInvoiceRecord(harness.getDataSource(), {
      connectionId: await connectionFor(RENDERING_ADAPTER_KEY, RENDERING_PLATFORM_TYPE),
    });

    const res = await http
      .get(`/v1/invoices/${record.id}/attachment`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      state: 'pdf',
      url: null,
      downloadPath: `/invoices/${record.id}/document?kind=rendered`,
    });
  });

  it('should answer link with the stored url when the provider renders nothing', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const record = await seedInvoiceRecord(harness.getDataSource(), {
      connectionId: await connectionFor(PLAIN_ADAPTER_KEY, PLAIN_PLATFORM_TYPE),
      pdfUrl: 'https://provider.example/invoice.pdf',
    });

    const res = await http
      .get(`/v1/invoices/${record.id}/attachment`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      state: 'link',
      url: 'https://provider.example/invoice.pdf',
      downloadPath: null,
    });
  });

  it('should answer waiting when the document is not cleared yet', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const record = await seedInvoiceRecord(harness.getDataSource(), {
      connectionId: await connectionFor(RENDERING_ADAPTER_KEY, RENDERING_PLATFORM_TYPE),
      regulatoryStatus: 'submitted',
      clearanceReference: null,
    });

    const res = await http
      .get(`/v1/invoices/${record.id}/attachment`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ state: 'waiting', url: null, downloadPath: null });
  });

  it('should 404 when the invoice id is unknown', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    await http
      .get('/v1/invoices/11111111-1111-1111-1111-111111111111/attachment')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
