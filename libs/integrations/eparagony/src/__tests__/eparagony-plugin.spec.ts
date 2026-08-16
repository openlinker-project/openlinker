/**
 * eparagony.pl Plugin Descriptor Tests
 *
 * Covers the descriptor seam: the static manifest shape, the static === runtime
 * manifest identity (no-drift invariant, #575), the side-registrations, the
 * capability dispatch, and the connection-bound outbound transport (#1810) the
 * descriptor must thread into every adapter it constructs.
 *
 * @module libs/integrations/eparagony/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import {
  createEparagonyPlugin,
  eparagonyAdapterManifest,
  EparagonyFiscalizationAdapter,
} from '../index';

const connection: Connection = {
  id: 'conn-eparagony-1',
  platformType: 'eparagony',
  name: 'Test eparagony.pl',
  status: 'active',
  config: { environment: 'sandbox', posId: 'pos-10' },
  credentialsRef: 'ref-1',
  enabledCapabilities: ['Fiscalization'],
  adapterKey: 'eparagony.documents.v3',
  createdAt: new Date(),
  updatedAt: new Date(),
};

interface Registry {
  register: jest.Mock;
}

function makeHost(): {
  host: HostServices;
  http: { forConnection: jest.Mock; evict: jest.Mock };
  registries: Record<string, Registry>;
} {
  const registries: Record<string, Registry> = {
    connectionConfigShapeValidatorRegistry: { register: jest.fn() },
    connectionCredentialsShapeValidatorRegistry: { register: jest.fn() },
    connectionTesterRegistry: { register: jest.fn() },
    retryClassifierRegistry: { register: jest.fn() },
    authFailureClassifierRegistry: { register: jest.fn() },
    inboundWebhookDecoderRegistry: { register: jest.fn() },
    webhookEventTranslatorRegistry: { register: jest.fn() },
  };
  const http = { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() };
  const host = {
    ...registries,
    http,
    logger: () => ({ log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    credentialsResolver: {
      get: jest.fn().mockResolvedValue({ clientId: 'id', clientSecret: 'secret' }),
    },
  } as unknown as HostServices;
  return { host, http, registries };
}

describe('createEparagonyPlugin', () => {
  describe('manifest', () => {
    it('should declare the fiscalization capability under its own adapter key', () => {
      expect(eparagonyAdapterManifest.adapterKey).toBe('eparagony.documents.v3');
      expect(eparagonyAdapterManifest.platformType).toBe('eparagony');
      expect(eparagonyAdapterManifest.supportedCapabilities).toEqual(['Fiscalization']);
    });

    it('should return the same manifest reference at runtime so static and runtime cannot drift', () => {
      expect(createEparagonyPlugin().manifest).toBe(eparagonyAdapterManifest);
    });

    it('should not declare a device sub-capability, which this vendor does not expose', () => {
      // The printer sits below the vendor's own boundary; `print`/`fiscalize`
      // are booleans on the document, not device operations (#1910 not planned).
      expect(eparagonyAdapterManifest.supportedCapabilities).not.toContain('FiscalDeviceOperator');
    });
  });

  describe('register', () => {
    it('should register the shape validators and both classifiers', () => {
      const { host, registries } = makeHost();
      createEparagonyPlugin().register?.(host);

      expect(registries.connectionConfigShapeValidatorRegistry.register).toHaveBeenCalledWith(
        'eparagony.documents.v3',
        expect.anything(),
      );
      expect(registries.connectionCredentialsShapeValidatorRegistry.register).toHaveBeenCalled();
      expect(registries.retryClassifierRegistry.register).toHaveBeenCalled();
      expect(registries.authFailureClassifierRegistry.register).toHaveBeenCalled();
      expect(registries.connectionTesterRegistry.register).toHaveBeenCalled();
    });

    it('should register no webhook decoder or translator, which would only dead-letter', () => {
      const { host, registries } = makeHost();
      createEparagonyPlugin().register?.(host);

      expect(registries.inboundWebhookDecoderRegistry.register).not.toHaveBeenCalled();
      expect(registries.webhookEventTranslatorRegistry.register).not.toHaveBeenCalled();
    });
  });

  describe('createCapabilityAdapter', () => {
    it('should build the fiscalization adapter over the connection-bound transport', async () => {
      const { host, http } = makeHost();
      const adapter = await createEparagonyPlugin().createCapabilityAdapter(
        connection,
        'Fiscalization',
        host,
      );

      expect(adapter).toBeInstanceOf(EparagonyFiscalizationAdapter);
      expect(http.forConnection).toHaveBeenCalledWith(connection);
    });

    it('should refuse a capability this plugin does not implement', async () => {
      const { host } = makeHost();
      await expect(
        createEparagonyPlugin().createCapabilityAdapter(connection, 'Invoicing', host),
      ).rejects.toThrow(/Invoicing/);
    });
  });
});
