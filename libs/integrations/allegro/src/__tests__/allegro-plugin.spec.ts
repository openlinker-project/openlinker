/**
 * Allegro Plugin Descriptor — unit tests
 *
 * Wire-up coverage for #586. Verifies that `register(host)` self-registers
 * the config-shape validator at `allegro.publicapi.v1`. Allegro deliberately
 * does NOT register a credentials-shape validator — token shape is enforced
 * by `AllegroAdapterFactory.resolveCredentials` deeper in the stack.
 *
 * @module libs/integrations/allegro/src/__tests__
 */
import type { HostServices } from '@openlinker/plugin-sdk';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

import { allegroAdapterManifest, createAllegroPlugin } from '../allegro-plugin';
import { AllegroAdapterFactory } from '../application/allegro-adapter.factory';

describe('allegroAdapterManifest', () => {
  it('declares the ShippingProviderManager capability so it routes as a source_brokered processor (#833)', () => {
    expect(allegroAdapterManifest.supportedCapabilities).toEqual(
      expect.arrayContaining(['OrderSource', 'OfferManager', 'ShippingProviderManager']),
    );
  });

  it('advertises the CategoryBrowser + EanCategoryMatcher OfferManager sub-capabilities so the bulk wizard renders the category-parameter step for a browsable taxonomy (#1367)', () => {
    // These drive the FE browsable-vs-borrows split on the connection response's
    // `supportedCapabilities`. The adapter implements both (guard-verified in
    // allegro-offer-manager.adapter.spec.ts); the manifest must advertise them
    // or the coarse list is silently missing them and Allegro is treated as a
    // borrows-taxonomy destination (no "Stan" parameter → PARAMETER_REQUIRED).
    expect(allegroAdapterManifest.supportedCapabilities).toEqual(
      expect.arrayContaining(['CategoryBrowser', 'EanCategoryMatcher']),
    );
  });

  it('advertises the CategoryPathReader OfferManager sub-capability so the bulk-wizard chip can resolve an EAN-auto-matched category id to a breadcrumb (#1741)', () => {
    expect(allegroAdapterManifest.supportedCapabilities).toEqual(
      expect.arrayContaining(['CategoryPathReader']),
    );
  });

  it('advertises OfferCreator + OfferEventReader so FE offer flows gate on the finer sub-capabilities (#1498)', () => {
    // FE offer-creation pickers gate on `OfferCreator` and the offers-sync
    // trigger on `OfferEventReader` — a quantity-only OfferManager
    // (WooCommerce stock write-back) must not surface in those flows.
    expect(allegroAdapterManifest.supportedCapabilities).toEqual(
      expect.arrayContaining(['OfferCreator', 'OfferEventReader']),
    );
  });

  it('declares catalog-implicit variant grouping so a per-variant category override is treated as consequential (#1924)', () => {
    expect(allegroAdapterManifest.variantGrouping).toBe('catalog-implicit');
  });
});

describe('createAllegroPlugin → register(host)', () => {
  function makeRegisterHost(): {
    host: HostServices;
    configRegistry: { register: jest.Mock };
    credentialsRegistry: { register: jest.Mock };
    oauthCompletionRegistry: { register: jest.Mock };
  } {
    const configRegistry = { register: jest.fn() };
    const credentialsRegistry = { register: jest.fn() };
    const oauthCompletionRegistry = { register: jest.fn() };
    const host = {
      identifierMapping: {} as IdentifierMappingPort,
      credentialsResolver: {} as CredentialsResolverPort,
      cache: undefined,
      // `register(host)` constructs the connection tester with `host.http`
      // (#1810). Stubbed so the wiring assertion below has something to check
      // — an undefined slot would still "pass" every other case in this file.
      http: { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() },
      connectionTesterRegistry: { register: jest.fn() },
      emailNormalizerRegistry: { register: jest.fn() },
      retryClassifierRegistry: { register: jest.fn() },
      authFailureClassifierRegistry: { register: jest.fn() },
      schedulerTaskRegistry: { register: jest.fn() },
      connectionConfigShapeValidatorRegistry: configRegistry,
      connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
      oauthCompletionRegistry,
    } as unknown as HostServices;
    return { host, configRegistry, credentialsRegistry, oauthCompletionRegistry };
  }

  it('registers the config-shape validator at adapterKey allegro.publicapi.v1', () => {
    const { host, configRegistry } = makeRegisterHost();
    // configService omitted — scheduler-task registration is skipped, which
    // keeps this spec narrowly focused on the shape-validator wiring.
    createAllegroPlugin({}).register?.(host);

    expect(configRegistry.register).toHaveBeenCalledWith(
      'allegro.publicapi.v1',
      expect.objectContaining({ validate: expect.any(Function) }),
    );
  });

  it('does NOT register a credentials-shape validator', () => {
    const { host, credentialsRegistry } = makeRegisterHost();
    createAllegroPlugin({}).register?.(host);

    expect(credentialsRegistry.register).not.toHaveBeenCalled();
  });

  it('registers the OAuth-completion adapter at adapterKey allegro.publicapi.v1', () => {
    const { host, oauthCompletionRegistry } = makeRegisterHost();
    createAllegroPlugin({}).register?.(host);

    expect(oauthCompletionRegistry.register).toHaveBeenCalledWith(
      'allegro.publicapi.v1',
      expect.objectContaining({
        buildAuthorizationUrl: expect.any(Function),
        exchangeCode: expect.any(Function),
        fetchAccountIdentity: expect.any(Function),
      }),
    );
  });
});

describe('createAllegroPlugin → createCapabilityAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeAdapterHost(): {
    host: HostServices;
    forConnection: jest.Mock;
    boundFetch: jest.Mock;
  } {
    const boundFetch = jest.fn();
    const forConnection = jest.fn().mockReturnValue(boundFetch);
    const host = {
      identifierMapping: {} as IdentifierMappingPort,
      credentialsResolver: {} as CredentialsResolverPort,
      cache: undefined,
      http: { forConnection, evict: jest.fn() },
    } as unknown as HostServices;
    return { host, forConnection, boundFetch };
  }

  const makeConnection = (): Connection =>
    ({ id: 'connection-1', platformType: 'allegro' }) as Connection;

  it('hands the connection-bound transport to the adapter factory, so every Allegro client paces on that connection (#1810)', async () => {
    // The load-bearing wiring of #1968: without it the clients fall back to
    // nothing (fetchImpl is required, so it would not compile) — but a future
    // refactor could just as easily resolve a transport for the WRONG
    // connection, which compiles fine and silently mixes two sellers' buckets.
    // Assert on the arguments, not merely that something was passed.
    const { host, forConnection, boundFetch } = makeAdapterHost();
    const connection = makeConnection();
    const createAdapters = jest
      .spyOn(AllegroAdapterFactory.prototype, 'createAdapters')
      .mockResolvedValue({
        offerManager: { kind: 'offerManager' },
        orderSource: {},
        shippingManager: {},
      } as never);

    await createAllegroPlugin({}).createCapabilityAdapter(connection, 'OfferManager', host);

    expect(forConnection).toHaveBeenCalledWith(connection, allegroAdapterManifest.defaultRateLimit);
    expect(createAdapters).toHaveBeenCalledWith(
      connection,
      host.identifierMapping,
      host.credentialsResolver,
      boundFetch
    );
  });
});
