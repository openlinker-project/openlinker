/**
 * `createOmsPlugin` — descriptor contract (#2405).
 *
 * @module libs/oms/src/__tests__
 */
import { createOmsPlugin, omsAdapterManifest } from '../oms.plugin';
import { OMS_ADAPTER_KEY, OMS_BRAND, OMS_PLATFORM_TYPE } from '../oms.constants';

describe('omsAdapterManifest', () => {
  it('should register under the versioned OMS adapter key and platform type', () => {
    expect(omsAdapterManifest.adapterKey).toBe(OMS_ADAPTER_KEY);
    expect(omsAdapterManifest.platformType).toBe(OMS_PLATFORM_TYPE);
  });

  it('should declare requiresCredentials false', () => {
    // The whole point of ADR-055's credential-less row. If this flips, the
    // create guard refuses the connection.
    expect(omsAdapterManifest.requiresCredentials).toBe(false);
  });

  it('should advertise NO capabilities until an adapter delivers one', () => {
    // The Erli #980 precedent. Advertising a name with no dispatch entry makes
    // `dispatchCapability` throw a plain Error, which aborts the WHOLE
    // `listCapabilityAdapters` listing rather than skipping this connection.
    expect(omsAdapterManifest.supportedCapabilities).toEqual([]);
  });

  it('should be the platform default, because the create form omits adapterKey', () => {
    // `resolveAdapterMetadata` falls back to `getDefaultAdapterKey(platformType)`
    // when no adapterKey is supplied — which the connection create form always
    // does. Without this the operator-created row resolves no adapter at all.
    expect(omsAdapterManifest.isDefault).toBe(true);
  });

  it('should declare no defaultRateLimit, because it issues no HTTP', () => {
    expect(omsAdapterManifest.defaultRateLimit).toBeUndefined();
  });
});

describe('createOmsPlugin', () => {
  it('should be constructible with no deps while the dispatch table is empty', () => {
    expect(() => createOmsPlugin()).not.toThrow();
  });

  it('should return the SAME manifest reference, so static and runtime cannot drift', () => {
    expect(createOmsPlugin().manifest).toBe(omsAdapterManifest);
  });

  it('should register no side registrations', () => {
    // No connection tester, scheduler task, webhook translator or shape
    // validator exists to register. `createNestAdapterModule` optional-chains
    // `plugin.register?.(host)`, so absence is supported.
    expect(createOmsPlugin().register).toBeUndefined();
  });

  it('should reject any capability request, naming the brand an operator recognises', async () => {
    await expect(
      createOmsPlugin().createCapabilityAdapter(
        {} as never,
        'FulfillmentExecutor',
        {} as never,
      ),
    ).rejects.toThrow(new RegExp(OMS_BRAND));
  });

  it('should report that it supports no capabilities in the rejection', async () => {
    await expect(
      createOmsPlugin().createCapabilityAdapter({} as never, 'OrderSource', {} as never),
    ).rejects.toThrow(/does not support capability/i);
  });
});
