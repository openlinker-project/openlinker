/**
 * `@openlinker/oms` — composition / DI boot integration test (#2390, `W3a-1`).
 *
 * **What this proves today.** That `OmsModule` composes and boots inside the
 * real Nest container as a member of `workerPlugins`, and — since #2405 — that
 * booting it actually REGISTERS the `openlinker.oms.v1` manifest, which is what
 * an operator-created OMS connection resolves through. That is not a
 * formality: booting the harness is the only thing in the repo that
 * exercises the whole #2390 registration chain end to end — the
 * `@openlinker/oms` jest `moduleNameMapper` entries (without them this file's
 * own import resolves the uncommitted `dist` and fails confusingly, #917),
 * the per-app tsconfig `paths`, and module resolution of a brand-new
 * workspace package. Every one of those registrations is otherwise
 * unexercised, and therefore unverifiable.
 *
 * **What this deliberately does NOT assert: that `OmsModule` injects no
 * `orders` / `inventory` service.** That would be wrong twice over. It is
 * vacuous — an empty module injects nothing, so the assertion would pass
 * while proving nothing — and, more importantly, it contradicts the design
 * of record: ADR-055 specifies that core services reach this plugin via
 * factory deps, `createOmsPlugin({inventoryQuery, orderRecords, products,
 * shipping, mappingConfig})`, all `I*Service`. `libs/oms` is *designed* to
 * receive exactly those two services, so a no-injection assertion here would
 * forbid what #2405 must do and would be deleted by it.
 *
 * The ADR-053 no-injection invariant belongs to `libs/core/src/fulfillment`,
 * a **core context** — a different subject. It is enforced statically today
 * by `scripts/check-no-injection-contracts.mjs` (armed for the moment #2391
 * creates that directory), and its runtime complement is the boot test
 * #2391 ships against that context.
 *
 * Note (#786): `apps/worker/test/**` is excluded from `pnpm lint` and
 * `pnpm type-check`, so this file compiles only under ts-jest at integration
 * time. A green lint/type-check says nothing about it.
 *
 * @module apps/worker/test/integration
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import { OmsModule } from '@openlinker/oms';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import { ADAPTER_REGISTRY_TOKEN } from '@openlinker/core/integrations';
import { getTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';

describe('@openlinker/oms — composition boot (#2390)', () => {
  let harness: WorkerIntegrationTestHarness;

  beforeAll(async () => {
    // Set BEFORE the container boots, and set here rather than relying on a
    // sibling spec — a boot gate that is run-order dependent is a boot gate you
    // cannot run to diagnose the boot it guards (the
    // `automation-dispatch-boot.int-spec.ts` precedent). Running this file alone
    // via `--runTestsByPath` is exactly the diagnostic path that matters for a
    // new package, and without this it dies in `getPiiConfig` before reaching
    // anything this spec is about.
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';

    // Booting the harness boots the real worker AppModule, which composes
    // `workerPlugins` through PluginRegistryModule.forRoot. A malformed or
    // unresolvable OmsModule fails here rather than in production.
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should resolve the @openlinker/oms barrel to a Nest module class when imported by specifier', () => {
    // Proves the jest moduleNameMapper pair and the package barrel resolve —
    // the registration this whole change exists to make non-silent.
    expect(OmsModule).toBeDefined();
    expect(typeof OmsModule).toBe('function');
    expect(OmsModule.name).toBe('OmsModule');
  });

  // The pre-#2405 `expect(workerPlugins).toContain(OmsModule)` is deliberately
  // GONE rather than adapted. `plugins.ts` now holds `OmsModule.register()`,
  // and `createNestAdapterModule` returns `{ module: <inner PluginHostModule> }`
  // — an anonymous class minted per call — so NO identity comparison against
  // `OmsModule` can succeed, and a weaker "is there a DynamicModule in the
  // array" check would assert almost nothing.
  //
  // The registry assertion below subsumes it completely: the manifest can only
  // be registered if the module really is composed into `workerPlugins` and
  // really did boot. An accidental removal from `plugins.ts` fails that test.

  it('should register the openlinker.oms.v1 manifest in the adapter registry at boot', async () => {
    // The honest assertion, and strictly stronger than the membership check
    // above: `toContain` was only ever a proxy for "the wiring is exercised",
    // and now that a manifest exists we can assert the thing that actually
    // matters — booting the real container registers the OMS adapter, so
    // `resolveAdapterMetadata` can find it for an operator-created connection.
    const registry = harness
      .getAppContext()
      .get<{ listAdapters: () => Promise<AdapterMetadata[]> }>(ADAPTER_REGISTRY_TOKEN, {
        strict: false,
      });

    const adapters = await registry.listAdapters();
    const oms = adapters.find((a) => a.adapterKey === 'openlinker.oms.v1');

    expect(oms).toBeDefined();
    expect(oms?.platformType).toBe('openlinker');
    // The declaration the credential-less create guard keys on (ADR-055).
    expect(oms?.requiresCredentials).toBe(false);
    // No capability is advertised until an adapter delivers one (#2409).
    expect(oms?.supportedCapabilities).toEqual([]);
  });

  it('should boot the real container with OmsModule composed', () => {
    // The assertion is the successful beforeAll; this pins that the harness
    // really came up rather than the suite passing on an unresolved promise.
    expect(harness).toBeDefined();
  });
});
