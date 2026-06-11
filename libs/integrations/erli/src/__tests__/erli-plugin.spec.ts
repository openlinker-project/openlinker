/**
 * Erli Plugin Descriptor Tests (#980)
 *
 * Asserts the static manifest shape, the static === runtime manifest
 * identity (no-drift invariant, #575), and the skeleton's typed rejection
 * from `createCapabilityAdapter` until the real adapters land (#984 / #993).
 *
 * @module libs/integrations/erli/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import { createErliPlugin, erliAdapterManifest } from '../erli-plugin';
import { ErliCapabilityNotImplementedException } from '../domain/exceptions/erli-capability-not-implemented.exception';

const connection: Connection = {
  id: 'conn-erli-1',
  platformType: 'erli',
  name: 'Test Erli',
  status: 'active',
  config: {} as Record<string, unknown>,
  credentialsRef: 'ref-1',
  enabledCapabilities: ['OrderSource', 'OfferManager'],
  adapterKey: 'erli.shopapi.v1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const host = {} as HostServices;

describe('erliAdapterManifest', () => {
  it('should declare the erli.shopapi.v1 adapter key', () => {
    expect(erliAdapterManifest.adapterKey).toBe('erli.shopapi.v1');
  });

  it('should declare the erli platform type', () => {
    expect(erliAdapterManifest.platformType).toBe('erli');
  });

  it('should declare OrderSource and OfferManager capabilities', () => {
    expect(erliAdapterManifest.supportedCapabilities).toEqual(['OrderSource', 'OfferManager']);
  });

  it('should be the platform-default adapter', () => {
    expect(erliAdapterManifest.isDefault).toBe(true);
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
    it.each(['OrderSource', 'OfferManager'])(
      'should reject with ErliCapabilityNotImplementedException when %s is requested',
      async (capability) => {
        const plugin = createErliPlugin();

        await expect(
          plugin.createCapabilityAdapter(connection, capability, host),
        ).rejects.toThrow(ErliCapabilityNotImplementedException);
      },
    );

    it('should reject a capability not declared in the manifest with the same typed exception', async () => {
      const plugin = createErliPlugin();

      await expect(
        plugin.createCapabilityAdapter(connection, 'ProductMaster', host),
      ).rejects.toThrow(ErliCapabilityNotImplementedException);
    });

    it('should name the requested capability in the rejection message', async () => {
      const plugin = createErliPlugin();

      await expect(plugin.createCapabilityAdapter(connection, 'OfferManager', host)).rejects.toThrow(
        /OfferManager/,
      );
    });
  });
});
