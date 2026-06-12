/**
 * Erli Plugin Descriptor Tests (#980)
 *
 * Asserts the static manifest shape (including the empty capability set the
 * skeleton ships), the static === runtime manifest identity (no-drift
 * invariant, #575), the SDK's uniform unsupported-capability rejection from
 * `createCapabilityAdapter` until the real adapters land (#984 / #993), and
 * that `ErliIntegrationModule` constructs via `createNestAdapterModule`.
 *
 * @module libs/integrations/erli/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import { createErliPlugin, erliAdapterManifest } from '../erli-plugin';
import { ErliIntegrationModule } from '../erli-integration.module';

const connection: Connection = {
  id: 'conn-erli-1',
  platformType: 'erli',
  name: 'Test Erli',
  status: 'active',
  config: {},
  credentialsRef: 'ref-1',
  enabledCapabilities: [],
  adapterKey: 'erli.shopapi.v1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// The skeleton's factory never reads the host bag; replace with a
// WooCommerce-style makeHostStub() when #982 adds register(host) tests.
const host = {} as HostServices;

describe('erliAdapterManifest', () => {
  it('should declare the erli.shopapi.v1 adapter key', () => {
    expect(erliAdapterManifest.adapterKey).toBe('erli.shopapi.v1');
  });

  it('should declare the erli platform type', () => {
    expect(erliAdapterManifest.platformType).toBe('erli');
  });

  it('should declare no capabilities while the skeleton ships no adapters', () => {
    // #993 adds 'OrderSource' and #984 adds 'OfferManager' alongside their
    // adapters — declaring them earlier would let listCapabilityAdapters
    // construct an adapter the factory cannot deliver.
    expect(erliAdapterManifest.supportedCapabilities).toEqual([]);
  });

  it('should be the platform-default adapter', () => {
    expect(erliAdapterManifest.isDefault).toBe(true);
  });

  it('should carry a display name and version', () => {
    expect(erliAdapterManifest.displayName).toBe('Erli Shop API v1');
    expect(erliAdapterManifest.version).toBe('1.0.0');
  });
});

describe('createErliPlugin', () => {
  it('should return the same manifest reference as the static export (no drift)', () => {
    expect(createErliPlugin().manifest).toBe(erliAdapterManifest);
  });

  it('should not define a register hook while the skeleton has no side-registrations', () => {
    // Side-registrations (connection tester, shape validators) arrive in #982.
    expect(createErliPlugin().register).toBeUndefined();
  });

  describe('createCapabilityAdapter', () => {
    it.each(['OrderSource', 'OfferManager', 'ProductMaster'])(
      'should reject %s with the SDK unsupported-capability error while no adapters ship',
      async (capability) => {
        const plugin = createErliPlugin();

        await expect(
          plugin.createCapabilityAdapter(connection, capability, host),
        ).rejects.toThrow(`Erli adapter does not support capability: ${capability}`);
      },
    );
  });
});

describe('ErliIntegrationModule', () => {
  it('should construct a DynamicModule via createNestAdapterModule when the package is loaded', () => {
    expect(ErliIntegrationModule.module).toBeDefined();
    expect(ErliIntegrationModule.imports?.length).toBeGreaterThan(0);
  });
});
