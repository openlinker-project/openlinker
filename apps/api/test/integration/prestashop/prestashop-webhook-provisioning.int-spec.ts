/**
 * PrestaShop Webhook Provisioning — Integration Test (#541)
 *
 * End-to-end guard for the install-webhooks flow: routes through the public
 * `PrestashopWebhookProvisioningAdapter.install()` method against a real
 * PrestaShop 9.0.2 instance (booted via the #506 Phase 1 Testcontainer
 * harness) with stubbed ports for connection / secret-rotation / credentials
 * resolution.
 *
 * Catches the #541 regression class:
 *   - Wrong WS body shape (the original double-wrap that 400'd in production
 *     while green at the unit-test layer because the unit spec asserted the
 *     buggy shape).
 *   - Partial-body PUT contract on `configurations`: `upsertConfiguration`
 *     sends only `{ id, name, value }` on update — this spec proves PS
 *     accepts that subset by re-running install (which exercises the
 *     update-existing branch).
 *
 * Suite-scoped: PS container starts in `beforeAll` (60-90s warm cache) and
 * stops in `afterAll`. Not wired into the global Postgres+Redis harness so
 * the existing fast int-specs are unaffected.
 *
 * @module apps/api/test/integration/prestashop
 */
import { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort, IWebhookSecretService } from '@openlinker/core/integrations';
import { PrestashopWebhookProvisioningAdapter } from '@openlinker/integrations-prestashop';
import {
  PrestashopTestContainer,
  startPrestashopContainer,
} from '../helpers/prestashop-container.helper';

interface PrestashopConfigurationRow {
  id: string | number;
  name?: string;
  value?: string;
}

/**
 * Read PS configurations by name via raw WS GET. Used to verify what
 * `install()` actually wrote on the PS side, independently of the
 * `PrestashopWebserviceClient` the service uses (so a bug in the read path
 * wouldn't mask a bug in the write path).
 */
async function fetchConfigurationByName(
  baseUrl: string,
  apiKey: string,
  name: string
): Promise<PrestashopConfigurationRow | null> {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/configurations`);
  url.searchParams.set('display', 'full');
  url.searchParams.set('output_format', 'JSON');
  url.searchParams.set('filter[name]', name);

  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `PS WS GET /api/configurations?filter[name]=${name} failed: ` +
        `${response.status} ${response.statusText} — ${body.slice(0, 200)}`
    );
  }
  const data = (await response.json()) as { configurations?: PrestashopConfigurationRow[] };
  const rows = Array.isArray(data.configurations) ? data.configurations : [];
  return rows[0] ?? null;
}

describe('PrestaShop webhook provisioning — install() against real PS (#541)', () => {
  let container: PrestashopTestContainer;
  let service: PrestashopWebhookProvisioningAdapter;

  // Stub state — a fresh secret is generated per `install()` call so we can
  // assert the second call rotated it. `connectionPort.update` captures the
  // patches the service applies; we assert on those, not on real DB state.
  let connectionPort: jest.Mocked<ConnectionPort>;
  let webhookSecretService: jest.Mocked<IWebhookSecretService>;
  let credentialsResolver: jest.Mocked<CredentialsResolverPort>;
  let baseConnection: Connection;
  let lastRotatedSecret: string;

  const TEST_CONNECTION_ID = 'test-conn-541';
  const TEST_CALLBACK_URL = 'http://test-callback.local';

  beforeAll(async () => {
    container = await startPrestashopContainer();
  }, 15 * 60_000);

  afterAll(async () => {
    if (container) {
      await container.cleanup();
    }
  });

  beforeEach(() => {
    baseConnection = new Connection(
      TEST_CONNECTION_ID,
      'prestashop',
      'Test PS Shop',
      'active',
      {
        baseUrl: container.baseUrl,
        openlinkerCallbackBaseUrl: TEST_CALLBACK_URL,
      },
      'db:test-cred-541',
      new Date(),
      new Date(),
      undefined,
      []
    );

    connectionPort = {
      get: jest.fn().mockResolvedValue(baseConnection),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue(baseConnection),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    webhookSecretService = {
      rotate: jest.fn().mockImplementation(async () => {
        // Secret content is opaque to PS — but the service writes it verbatim
        // into `OPENLINKER_WEBHOOK_SECRET`, so we assert round-trip equality.
        // Fresh per-call so the second `install()` produces a different value
        // and we can prove the update branch ran (vs. a no-op).
        lastRotatedSecret = `test-secret-541-${Math.random().toString(36).slice(2, 10)}`;
        return { secret: lastRotatedSecret };
      }),
    } as unknown as jest.Mocked<IWebhookSecretService>;

    credentialsResolver = {
      get: jest.fn().mockResolvedValue({
        webserviceApiKey: container.webserviceApiKey,
      }),
    } as unknown as jest.Mocked<CredentialsResolverPort>;

    service = new PrestashopWebhookProvisioningAdapter(
      connectionPort,
      webhookSecretService,
      credentialsResolver
    );
  });

  it('writes the three OPENLINKER_* configurations into PS on first install', async () => {
    const result = await service.install(TEST_CONNECTION_ID, 'actor-541');

    // The WS push is the part this test guards. The synchronous ping is
    // best-effort and the OL PS module is not installed in this harness,
    // but PS's storefront still returns a 2xx for `/module/openlinker/ping`
    // (it falls through to a generic page), so `testPingTriggered` is
    // non-deterministic from the outside — we don't assert on it.
    expect(result.webhooksConfigured).toBe(true);

    expect(connectionPort.update).toHaveBeenCalledWith(
      TEST_CONNECTION_ID,
      expect.objectContaining({
        config: expect.objectContaining({ webhooksConfigured: true }),
      })
    );

    // PS-side proof — read the rows back via a separate raw fetch (different
    // code path from the one the service uses to write). All three keys
    // must be present with the values the service wrote.
    const baseUrlRow = await fetchConfigurationByName(
      container.baseUrl,
      container.webserviceApiKey,
      'OPENLINKER_BASE_URL'
    );
    expect(baseUrlRow).not.toBeNull();
    expect(baseUrlRow?.value).toBe(TEST_CALLBACK_URL);

    const connectionIdRow = await fetchConfigurationByName(
      container.baseUrl,
      container.webserviceApiKey,
      'OPENLINKER_CONNECTION_ID'
    );
    expect(connectionIdRow).not.toBeNull();
    expect(connectionIdRow?.value).toBe(TEST_CONNECTION_ID);

    const secretRow = await fetchConfigurationByName(
      container.baseUrl,
      container.webserviceApiKey,
      'OPENLINKER_WEBHOOK_SECRET'
    );
    expect(secretRow).not.toBeNull();
    expect(secretRow?.value).toBe(lastRotatedSecret);
  });

  it('updates rows in place on a second install (idempotent + partial-body PUT)', async () => {
    // First install creates the rows — fixture for the update path.
    await service.install(TEST_CONNECTION_ID, 'actor-541');
    const firstSecretRow = await fetchConfigurationByName(
      container.baseUrl,
      container.webserviceApiKey,
      'OPENLINKER_WEBHOOK_SECRET'
    );
    expect(firstSecretRow).not.toBeNull();
    const firstId = firstSecretRow!.id;
    const firstSecret = firstSecretRow!.value;

    // Second install — the secret rotates to a new value, the WS list-by-name
    // returns the existing row, and `upsertConfiguration` takes the
    // `updateResource` branch with a flat `{ id, name, value }` body. If PS
    // rejected partial-body PUTs (the conservative reading of the WS client
    // interface JSDoc), this call would 400 and the test would fail.
    await service.install(TEST_CONNECTION_ID, 'actor-541');

    const secondSecretRow = await fetchConfigurationByName(
      container.baseUrl,
      container.webserviceApiKey,
      'OPENLINKER_WEBHOOK_SECRET'
    );
    expect(secondSecretRow).not.toBeNull();
    // Same row (no duplicate insert) — same id_configuration.
    expect(String(secondSecretRow!.id)).toBe(String(firstId));
    // New value — proves the update branch ran end-to-end against PS.
    expect(secondSecretRow!.value).toBe(lastRotatedSecret);
    expect(secondSecretRow!.value).not.toBe(firstSecret);
  });
});
