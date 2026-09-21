/**
 * Subiekt Plugin Descriptor — unit tests (#753)
 *
 * Manifest shape, side-registrations, capability dispatch, and the
 * optional-credentials / bad-URL rejection behaviour.
 *
 * @module libs/integrations/subiekt/src/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import { createSubiektPlugin, subiektAdapterManifest } from '../subiekt-plugin';
import { SubiektInvoicingAdapter } from '../infrastructure/adapters/subiekt-invoicing.adapter';
import { SubiektConfigException } from '../domain/exceptions/subiekt-config.exception';

function makeConnection(overrides: Partial<{ config: Record<string, unknown>; credentialsRef: string }> = {}): Connection {
  return new Connection(
    'conn-1',
    'subiekt' as never,
    'Test',
    'active' as never,
    (overrides.config ?? { bridgeBaseUrl: 'http://192.168.1.10:5000' }) as never,
    overrides.credentialsRef ?? '',
    new Date(),
    new Date(),
    subiektAdapterManifest.adapterKey,
    ['Invoicing'],
  );
}

function makeHost(getImpl?: jest.Mock): HostServices {
  return {
    credentialsResolver: {
      get: getImpl ?? jest.fn().mockResolvedValue({ bridgeToken: 'secret-token' }),
    },
    http: {
      forConnection: jest.fn().mockReturnValue(jest.fn()),
      evict: jest.fn(),
    },
  } as unknown as HostServices;
}

describe('createSubiektPlugin', () => {
  describe('manifest', () => {
    it("supportedCapabilities includes 'Invoicing'", () => {
      expect(subiektAdapterManifest.supportedCapabilities).toContain('Invoicing');
    });

    it("adapterKey is 'subiekt.invoicing.v1' and platformType is 'subiekt'", () => {
      expect(subiektAdapterManifest.adapterKey).toBe('subiekt.invoicing.v1');
      expect(subiektAdapterManifest.platformType).toBe('subiekt');
    });

    it('createSubiektPlugin().manifest === subiektAdapterManifest (no drift)', () => {
      expect(createSubiektPlugin().manifest).toBe(subiektAdapterManifest);
    });
  });

  describe('register', () => {
    function makeRegisterHost(): {
      host: HostServices;
      configRegister: jest.Mock;
      testerRegister: jest.Mock;
      retryClassifierRegister: jest.Mock;
      authFailureClassifierRegister: jest.Mock;
      schedulerTaskRegister: jest.Mock;
    } {
      const configRegister = jest.fn();
      const testerRegister = jest.fn();
      const retryClassifierRegister = jest.fn();
      const authFailureClassifierRegister = jest.fn();
      const schedulerTaskRegister = jest.fn();
      const host = {
        connectionConfigShapeValidatorRegistry: { register: configRegister },
        connectionTesterRegistry: { register: testerRegister },
        retryClassifierRegistry: { register: retryClassifierRegister },
        authFailureClassifierRegistry: { register: authFailureClassifierRegister },
        schedulerTaskRegistry: { register: schedulerTaskRegister },
      } as unknown as HostServices;
      return {
        host,
        configRegister,
        testerRegister,
        retryClassifierRegister,
        authFailureClassifierRegister,
        schedulerTaskRegister,
      };
    }

    it('registers the config-shape validator under the adapterKey', () => {
      const { host, configRegister } = makeRegisterHost();
      const plugin = createSubiektPlugin();
      expect(plugin.register).toBeDefined();
      plugin.register?.(host);
      expect(configRegister).toHaveBeenCalledWith(
        subiektAdapterManifest.adapterKey,
        expect.anything(),
      );
    });

    it('registers the connection tester under the adapterKey', () => {
      const { host, testerRegister } = makeRegisterHost();
      createSubiektPlugin().register?.(host);
      expect(testerRegister).toHaveBeenCalledWith(
        subiektAdapterManifest.adapterKey,
        expect.anything(),
      );
    });

    it('registers the retry classifier under the adapterKey (fiscal-safety pivot)', () => {
      const { host, retryClassifierRegister } = makeRegisterHost();
      createSubiektPlugin().register?.(host);
      expect(retryClassifierRegister).toHaveBeenCalledWith(
        subiektAdapterManifest.adapterKey,
        expect.anything(),
      );
    });

    it('registers the auth-failure classifier under the adapterKey (#3358)', () => {
      const { host, authFailureClassifierRegister } = makeRegisterHost();
      createSubiektPlugin().register?.(host);
      expect(authFailureClassifierRegister).toHaveBeenCalledWith(
        subiektAdapterManifest.adapterKey,
        expect.anything(),
      );
    });

    it('registers the bridge reachability sweep scheduler task (#3358)', () => {
      const { host, schedulerTaskRegister } = makeRegisterHost();
      createSubiektPlugin().register?.(host);
      expect(schedulerTaskRegister).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'subiekt-bridge-reachability-sweep',
          platformType: 'subiekt',
          jobType: 'subiekt.bridge.reachabilitySweep',
        }),
      );
    });
  });

  describe('createCapabilityAdapter', () => {
    it("returns a SubiektInvoicingAdapter for 'Invoicing'", async () => {
      const plugin = createSubiektPlugin();
      const adapter = await plugin.createCapabilityAdapter(
        makeConnection(),
        'Invoicing',
        makeHost(),
      );
      expect(adapter).toBeInstanceOf(SubiektInvoicingAdapter);
    });

    it('resolves the connection-bound transport via host.http.forConnection with the manifest defaultRateLimit (#1810)', async () => {
      const host = makeHost();
      const connection = makeConnection();

      await createSubiektPlugin().createCapabilityAdapter(connection, 'Invoicing', host);

      expect(host.http.forConnection).toHaveBeenCalledWith(
        connection,
        subiektAdapterManifest.defaultRateLimit,
      );
    });

    it('rejects for an unknown capability', async () => {
      // ProductMaster is a real, supported capability as of the Subiekt GT
      // multi-capability build (#3192-epic) - 'ShippingProviderManager' is
      // never supported by this adapter and stays a genuine negative case.
      const plugin = createSubiektPlugin();
      await expect(
        plugin.createCapabilityAdapter(makeConnection(), 'ShippingProviderManager', makeHost()),
      ).rejects.toThrow();
    });

    it('rejects for Fiscalization when the connection has no drukarkaFiskalnaId configured', async () => {
      const plugin = createSubiektPlugin();
      await expect(
        plugin.createCapabilityAdapter(makeConnection(), 'Fiscalization', makeHost()),
      ).rejects.toThrow();
    });

    it("resolves when connection.credentialsRef === '' WITHOUT calling credentialsResolver.get", async () => {
      const get = jest.fn();
      const plugin = createSubiektPlugin();
      const adapter = await plugin.createCapabilityAdapter(
        makeConnection({ credentialsRef: '' }),
        'Invoicing',
        makeHost(get),
      );
      expect(adapter).toBeInstanceOf(SubiektInvoicingAdapter);
      expect(get).not.toHaveBeenCalled();
    });

    it('returns a rejected Promise (SubiektConfigException-shaped) for an IMDS/bad bridgeBaseUrl', async () => {
      const plugin = createSubiektPlugin();
      await expect(
        plugin.createCapabilityAdapter(
          makeConnection({ config: { bridgeBaseUrl: 'http://169.254.169.254' } }),
          'Invoicing',
          makeHost(),
        ),
      ).rejects.toBeInstanceOf(SubiektConfigException);
    });
  });
});
