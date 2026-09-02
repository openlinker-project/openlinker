/**
 * `createOmsPlugin` — descriptor contract (#2405).
 *
 * @module libs/oms/src/__tests__
 */
import { OlFulfillmentExecutorAdapter } from '../execution/ol-fulfillment-executor.adapter';
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

  it('should advertise exactly the capabilities it has an adapter for', () => {
    // The Erli #980 precedent: a name enters this array WITH its adapter, never
    // before. Advertising a name with no dispatch entry makes
    // `dispatchCapability` throw a plain Error, which aborts the WHOLE
    // `listCapabilityAdapters` listing rather than skipping this connection.
    // #2409 added `FulfillmentExecutor` together with
    // `OlFulfillmentExecutorAdapter`; this assertion is what keeps the pairing
    // honest, so adding a second name without its dispatch entry fails here.
    expect(omsAdapterManifest.supportedCapabilities).toEqual(['FulfillmentExecutor']);
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
  it('should be constructible with no deps, because the executor injects none', () => {
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

  it('should resolve the OL executor for FulfillmentExecutor', async () => {
    // The pairing the manifest assertion above declares. Resolved through the
    // ordinary `dispatchCapability` path — core reaches the OL-OMS by exactly
    // the seam it reaches any vendor plugin by (ADR-055: no privileged path).
    await expect(
      createOmsPlugin().createCapabilityAdapter({} as never, 'FulfillmentExecutor', {} as never),
    ).resolves.toBeInstanceOf(OlFulfillmentExecutorAdapter);
  });

  it('should build a fresh executor per resolution rather than sharing one instance', async () => {
    const plugin = createOmsPlugin();
    const first = await plugin.createCapabilityAdapter({} as never, 'FulfillmentExecutor', {} as never);
    const second = await plugin.createCapabilityAdapter({} as never, 'FulfillmentExecutor', {} as never);

    expect(first).not.toBe(second);
  });

  it('should reject an unsupported capability, naming the brand an operator recognises', async () => {
    await expect(
      createOmsPlugin().createCapabilityAdapter({} as never, 'OrderSource', {} as never),
    ).rejects.toThrow(new RegExp(OMS_BRAND));
  });

  it('should name the capability it does not support in the rejection', async () => {
    await expect(
      createOmsPlugin().createCapabilityAdapter({} as never, 'OrderSource', {} as never),
    ).rejects.toThrow(/does not support capability/i);
  });
});
