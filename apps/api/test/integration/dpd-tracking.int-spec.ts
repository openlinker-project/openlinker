/**
 * DPD Tracking Integration Test (#965, ADR-022)
 *
 * Proves the DPD tracking chain wired through real DI: a seeded DPD connection
 * resolves the real `DpdShippingAdapter` via `IntegrationsService`
 * (factory → credentials → SOAP client → mapper), and `getTracking` decodes a
 * (mocked) DPD InfoServices `getEventsForWaybillV1` SOAP response into a neutral
 * `TrackingSnapshot`. Only the outbound SOAP HTTP call is stubbed (global
 * `fetch`); the resolution chain + envelope build + XML parse + status mapping
 * are all real.
 *
 * @module apps/api/test/integration
 */
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import type { ShippingProviderManagerPort } from '@openlinker/core/shipping';
import { createTestConnection } from './helpers/test-connection.helper';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';

const CRED_REF = 'dpd-tracking-cred';

function soapResponse(body: string): Response {
  return { ok: true, status: 200, text: () => Promise.resolve(body) } as unknown as Response;
}

function eventsEnvelope(rows: string): string {
  return `<?xml version="1.0"?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:getEventsForWaybillV1Response xmlns:ns2="http://events.dpdinfoservices.dpd.com.pl/">
      <return><confirmId>abc=</confirmId>${rows}</return>
    </ns2:getEventsForWaybillV1Response>
  </S:Body>
</S:Envelope>`;
}

describe('DPD Tracking Integration (#965)', () => {
  let harness: IntegrationTestHarness;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedDpdConnection(): Promise<string> {
    const dataSource = harness.getDataSource();
    const { key } = loadEncryptionKey(process.env);
    await dataSource.getRepository(IntegrationCredentialOrmEntity).save(
      dataSource.getRepository(IntegrationCredentialOrmEntity).create({
        ref: CRED_REF,
        platformType: 'dpd',
        credentialsCiphertext: encryptWithKey(key, JSON.stringify({ login: 'test', password: 'secret' })),
      }),
    );
    const connection = await createTestConnection(dataSource, {
      platformType: 'dpd',
      name: 'DPD Polska',
      adapterKey: 'dpd.polska.rest.v1',
      enabledCapabilities: ['ShippingProviderManager'],
      credentialsRef: `db:${CRED_REF}`,
      config: {
        environment: 'sandbox',
        payerFid: '1495',
        senderAddress: {
          name: 'Sklep ACME',
          address: 'Magazynowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
          countryCode: 'PL',
        },
      },
    });
    return connection.id;
  }

  const resolveAdapter = (connectionId: string): Promise<ShippingProviderManagerPort> =>
    harness
      .getApp()
      .get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN)
      .getCapabilityAdapter<ShippingProviderManagerPort>(connectionId, 'ShippingProviderManager');

  it('resolves the real DPD adapter and maps a delivered SOAP history to a snapshot', async () => {
    const connectionId = await seedDpdConnection();
    const fetchMock = jest.fn().mockResolvedValue(
      soapResponse(
        eventsEnvelope(
          `<eventsList><businessCode>040101</businessCode><eventTime>2026-06-10T08:00:00</eventTime><waybill>WB1</waybill></eventsList>` +
            `<eventsList><businessCode>190101</businessCode><eventTime>2026-06-11T14:30:00</eventTime><waybill>WB1</waybill></eventsList>`,
        ),
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = await resolveAdapter(connectionId);
    const snapshot = await adapter.getTracking({ providerShipmentId: 'WB1' });

    expect(snapshot.status).toBe('delivered');
    expect(snapshot.providerStatus).toBe('190101');
    expect(snapshot.deliveredAt?.toISOString()).toBe('2026-06-11T12:30:00.000Z');

    // The SOAP call hit the InfoServices host (not the REST shipment host).
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('dpdinfoservices');
    expect(url).toContain('/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents');
    expect(init.method).toBe('POST');
    expect(init.body as string).toContain('<waybill>WB1</waybill>');
  });

  it('maps an empty event history to a generated snapshot', async () => {
    const connectionId = await seedDpdConnection();
    global.fetch = jest.fn().mockResolvedValue(soapResponse(eventsEnvelope(''))) as unknown as typeof fetch;

    const adapter = await resolveAdapter(connectionId);
    await expect(adapter.getTracking({ providerShipmentId: 'WB-NONE' })).resolves.toEqual({
      status: 'generated',
      carrier: 'dpd',
    });
  });
});
