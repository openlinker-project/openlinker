/**
 * Infakt Plugin Descriptor Tests (#1973)
 *
 * Covers the descriptor seam the package previously had no test for: the static
 * manifest shape, the static === runtime manifest identity (no-drift invariant,
 * #575), and the connection-bound outbound transport (#1810) that `register` and
 * `createCapabilityAdapter` must thread into every adapter they construct.
 *
 * The transport assertions exist because `host.http` is a REQUIRED constructor
 * dependency of `InfaktConnectionTesterAdapter` — without a test, a regression
 * that stopped supplying it would construct the tester with `undefined` and every
 * other assertion in the package would still pass.
 *
 * @module libs/integrations/infakt/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { ConnectionTesterPort, CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HostServices } from '@openlinker/plugin-sdk';
import { createInfaktPlugin, infaktAdapterManifest } from '../index';

const connection: Connection = {
  id: 'conn-infakt-1',
  platformType: 'infakt',
  name: 'Test Infakt',
  status: 'active',
  config: {},
  credentialsRef: 'ref-1',
  enabledCapabilities: [],
  adapterKey: 'infakt.accounting.v1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Host stub carrying the registries `register(host)` touches plus the outbound
 * transport factory. `http` is a real mock rather than absent on purpose: the
 * registration assertions pass either way, so only driving the registered
 * adapter proves the transport was threaded.
 */
function makeHost(): {
  host: HostServices;
  http: { forConnection: jest.Mock; evict: jest.Mock };
  configRegistry: { register: jest.Mock };
  credentialsRegistry: { register: jest.Mock };
  testerRegistry: { register: jest.Mock };
  retryClassifierRegistry: { register: jest.Mock };
  inboundWebhookDecoderRegistry: { register: jest.Mock };
  webhookEventTranslatorRegistry: { register: jest.Mock };
  credentialsResolver: { get: jest.Mock };
} {
  const configRegistry = { register: jest.fn() };
  const credentialsRegistry = { register: jest.fn() };
  const testerRegistry = { register: jest.fn() };
  const retryClassifierRegistry = { register: jest.fn() };
  const inboundWebhookDecoderRegistry = { register: jest.fn() };
  const webhookEventTranslatorRegistry = { register: jest.fn() };
  const credentialsResolver = { get: jest.fn().mockResolvedValue({ apiKey: 'k-123' }) };
  const http = { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() };
  const hostStub = {
    http,
    credentialsResolver,
    connectionConfigShapeValidatorRegistry: configRegistry,
    connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
    connectionTesterRegistry: testerRegistry,
    retryClassifierRegistry,
    inboundWebhookDecoderRegistry,
    webhookEventTranslatorRegistry,
  } as unknown as HostServices;
  return {
    host: hostStub,
    http,
    configRegistry,
    credentialsRegistry,
    testerRegistry,
    retryClassifierRegistry,
    inboundWebhookDecoderRegistry,
    webhookEventTranslatorRegistry,
    credentialsResolver,
  };
}

describe('infaktAdapterManifest', () => {
  it('should declare the infakt.accounting.v1 adapter key and platform type', () => {
    expect(infaktAdapterManifest.adapterKey).toBe('infakt.accounting.v1');
    expect(infaktAdapterManifest.platformType).toBe('infakt');
  });

  it('should declare only Invoicing — the sub-capabilities are narrowed via guards, not listed (mirrors KSeF)', () => {
    expect(infaktAdapterManifest.supportedCapabilities).toEqual(['Invoicing']);
  });

  it('should declare NO defaultRateLimit — a manifest default is for merchant-hosted platforms, not accounting SaaS (#1810 §1)', () => {
    // Reinstating this would throttle every existing Infakt connection with no
    // operator action, and Infakt is the worst adapter for that: its async-task
    // polls are bounded by a 30s wall-clock deadline, so a starved poll reports
    // `in-doubt` on a fiscal document the provider actually created.
    expect(infaktAdapterManifest.defaultRateLimit).toBeUndefined();
  });
});

describe('createInfaktPlugin', () => {
  it('should return the same manifest reference as the static export (no drift)', () => {
    expect(createInfaktPlugin().manifest).toBe(infaktAdapterManifest);
  });

  describe('register', () => {
    it('should register the config + credentials shape validators at infakt.accounting.v1', () => {
      const { host, configRegistry, credentialsRegistry } = makeHost();
      createInfaktPlugin().register?.(host);

      expect(configRegistry.register).toHaveBeenCalledWith(
        'infakt.accounting.v1',
        expect.objectContaining({ validate: expect.any(Function) }),
      );
      expect(credentialsRegistry.register).toHaveBeenCalledWith(
        'infakt.accounting.v1',
        expect.objectContaining({ validate: expect.any(Function) }),
      );
    });

    it('should register the retry classifier at infakt.accounting.v1', () => {
      const { host, retryClassifierRegistry } = makeHost();
      createInfaktPlugin().register?.(host);

      expect(retryClassifierRegistry.register).toHaveBeenCalledWith(
        'infakt.accounting.v1',
        expect.anything(),
      );
    });

    it('should register the webhook decoder by platform type and the translator by adapter key (#1281)', () => {
      const { host, inboundWebhookDecoderRegistry, webhookEventTranslatorRegistry } = makeHost();
      createInfaktPlugin().register?.(host);

      expect(inboundWebhookDecoderRegistry.register).toHaveBeenCalledWith('infakt', expect.anything());
      expect(webhookEventTranslatorRegistry.register).toHaveBeenCalledWith(
        'infakt.accounting.v1',
        expect.anything(),
      );
    });

    it('should register a connection tester wired to the host outbound transport (#1810)', async () => {
      const { host, http, testerRegistry } = makeHost();
      createInfaktPlugin().register?.(host);

      const registrations = testerRegistry.register.mock.calls as unknown as [
        string,
        ConnectionTesterPort,
      ][];
      expect(registrations).toHaveLength(1);
      const tester = registrations[0][1];

      // Unlike Erli's tester, this one resolves credentials FIRST and the
      // transport second, so the resolver must succeed for the probe to reach
      // `forConnection` at all. The probe itself then fails at the transport,
      // which is what makes this an assertion about wiring rather than about
      // Infakt's API. Driving the registered instance (not reading a private
      // field) keeps the test valid if the construction seam changes shape.
      http.forConnection.mockReturnValue(
        jest.fn().mockRejectedValue(new Error('transport unreachable in this fixture')),
      );
      const result = await tester.test(connection, {
        get: jest.fn().mockResolvedValue({ apiKey: 'k-123' }),
      } as unknown as CredentialsResolverPort);

      // Exactly one argument: a second would reintroduce the adapter-level default
      // cap Infakt deliberately does not declare (see the manifest spec above).
      expect(http.forConnection).toHaveBeenCalledWith(connection);
      expect(result.success).toBe(false);
    });
  });

  describe('createCapabilityAdapter', () => {
    it('should resolve the connection-bound transport with no manifest policy argument (#1810)', async () => {
      const { host, http } = makeHost();

      await createInfaktPlugin().createCapabilityAdapter(connection, 'Invoicing', host);

      expect(http.forConnection).toHaveBeenCalledWith(connection);
    });

    it('should reject an unsupported capability with the SDK unsupported-capability error', async () => {
      const { host } = makeHost();

      await expect(
        createInfaktPlugin().createCapabilityAdapter(connection, 'ProductMaster', host),
      ).rejects.toThrow('Infakt adapter does not support capability: ProductMaster');
    });
  });
});
