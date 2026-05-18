/**
 * Allegro Test OfferManagerPort Stub Helper (#742)
 *
 * Boot-time-registered fake `OfferManagerPort` + `OfferCreator` adapter for
 * end-to-end bulk-flow int-specs. Mirrors the pattern established by
 * `allegro-test-source-stub.helper.ts` (#535): registers a test-only
 * `adapterKey='allegro.test.offer-manager.v1'` with the running Nest app's
 * `AdapterRegistryService` + `AdapterFactoryResolverService`, so connections
 * pointed at that adapterKey resolve through the same production path
 * `IntegrationsService.getCapabilityAdapter` uses for real adapters.
 *
 * The stub is **programmable per-variant** via `setNextCreateResult` —
 * each internal variant id can be scripted to succeed (returns a
 * `CreateOfferResult`) or fail (throws `OfferCreateRejectedException`).
 * Lets int-specs drive the full submit → drain → retry → drain happy path
 * without real Allegro OAuth.
 *
 * Lifetime: suite-scoped. Call `installAllegroTestOfferManagerStub(harness)`
 * once in `beforeAll`. `AdapterRegistryService.register` throws
 * `DuplicateAdapterKeyException` on a second call for the same adapterKey
 * — intentional; the stub lives for the lifetime of the Nest process under test.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  OfferCreateRejectedException,
  type CreateOfferCommand,
  type CreateOfferResult,
  type CreateOfferValidationError,
  type OfferCreator,
  type OfferManagerPort,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';

import type { IntegrationTestHarness } from '../setup';

export const ALLEGRO_TEST_OFFER_MANAGER_ADAPTER_KEY = 'allegro.test.offer-manager.v1';
export const ALLEGRO_TEST_OFFER_MANAGER_PLATFORM_TYPE = 'allegro';

/**
 * Scripted result for one variant. `kind: 'success'` returns
 * `CreateOfferResult`; `kind: 'failure'` throws
 * `OfferCreateRejectedException` with the given errors.
 */
export type ScriptedCreateResult =
  | {
      kind: 'success';
      externalOfferId: string;
      status: 'draft' | 'validating' | 'active';
      validationErrors?: CreateOfferValidationError[];
    }
  | {
      kind: 'failure';
      statusCode: number;
      errors: CreateOfferValidationError[];
    };

export interface AllegroTestOfferManagerStub {
  readonly adapterKey: string;
  readonly platformType: string;
  /**
   * Script the next `createOffer` call for a given internal variant id.
   * Replaces any prior script for the same variant. The stub looks the
   * script up by `cmd.internalVariantId` at create time.
   */
  setNextCreateResult(internalVariantId: string, result: ScriptedCreateResult): void;
  /** Reset all scripted results. Useful between scenarios in the same suite. */
  reset(): void;
}

export function installAllegroTestOfferManagerStub(
  harness: IntegrationTestHarness
): AllegroTestOfferManagerStub {
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const scripts = new Map<string, ScriptedCreateResult>();

  const stub: OfferManagerPort & OfferCreator = {
    updateOfferQuantity(_cmd: UpdateOfferQuantityCommand): Promise<void> {
      return Promise.resolve();
    },
    createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
      const script = scripts.get(cmd.internalVariantId);
      if (!script) {
        return Promise.reject(
          new Error(
            `allegro-test-offer-manager-stub: no scripted result for variant ${cmd.internalVariantId}. ` +
              `Call setNextCreateResult(variantId, ...) before draining.`
          )
        );
      }
      if (script.kind === 'failure') {
        return Promise.reject(
          new OfferCreateRejectedException(
            ALLEGRO_TEST_OFFER_MANAGER_ADAPTER_KEY,
            script.statusCode,
            script.errors
          )
        );
      }
      const result: CreateOfferResult = {
        externalOfferId: script.externalOfferId,
        status: script.status,
        ...(script.validationErrors !== undefined && {
          validationErrors: script.validationErrors,
        }),
      };
      return Promise.resolve(result);
    },
  };

  adapterRegistry.register({
    adapterKey: ALLEGRO_TEST_OFFER_MANAGER_ADAPTER_KEY,
    platformType: ALLEGRO_TEST_OFFER_MANAGER_PLATFORM_TYPE,
    supportedCapabilities: ['OfferManager'],
    displayName: 'Allegro OfferManager (integration-test stub)',
    version: '0.0.0-test',
    // Explicit false so the real `allegro.publicapi.v1` stays the platform default.
    isDefault: false,
  });

  factoryResolver.registerFactory(ALLEGRO_TEST_OFFER_MANAGER_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(stub as unknown as T),
  });

  return {
    adapterKey: ALLEGRO_TEST_OFFER_MANAGER_ADAPTER_KEY,
    platformType: ALLEGRO_TEST_OFFER_MANAGER_PLATFORM_TYPE,
    setNextCreateResult(internalVariantId: string, result: ScriptedCreateResult): void {
      scripts.set(internalVariantId, result);
    },
    reset(): void {
      scripts.clear();
    },
  };
}
