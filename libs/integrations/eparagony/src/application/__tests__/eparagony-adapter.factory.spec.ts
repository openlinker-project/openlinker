/**
 * eparagony.pl Adapter Factory Tests
 *
 * Covers the per-connection construction seam: the loud-and-early refusals, and
 * the invariant the bag shape exists for - both capability adapters ride ONE
 * `EparagonyHttpClient` (#3192).
 *
 * @module libs/integrations/eparagony/src/application/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';

import { EparagonyAdapterFactory } from '../eparagony-adapter.factory';
import { EparagonyConfigException } from '../../domain/exceptions/eparagony-config.exception';
import { EparagonyFiscalizationAdapter } from '../../infrastructure/adapters/eparagony-fiscalization.adapter';
import { EparagonyHttpClient } from '../../infrastructure/http/eparagony-http-client';
import { EparagonyInvoicingAdapter } from '../../infrastructure/adapters/eparagony-invoicing.adapter';

/**
 * Both adapters keep their transport on a private `http` field, so reading it is
 * the direct expression of the shared-client invariant. A behavioural proof
 * (drive one call on each adapter, count token requests) would assert the same
 * thing through two full wire round-trips, and would fail for reasons that have
 * nothing to do with construction.
 */
function transportOf(adapter: unknown): unknown {
  return (adapter as { http: unknown }).http;
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
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
    ...overrides,
  };
}

/**
 * The smallest command `issueInvoice` will carry as far as composition, which is
 * where a connection with no `merchantTIN` is refused. Typed loosely on purpose:
 * this spec is about the construction seam, and the command's full shape is the
 * mapper spec's subject.
 */
function makeIssueCommand(): Parameters<EparagonyInvoicingAdapter['issueInvoice']>[0] {
  return {
    connectionId: 'conn-eparagony-1',
    orderId: 'ol_order_1',
    buyer: {
      name: 'Firma Polska sc.',
      taxId: null,
      address: {
        line1: 'Pl. Obroncow Lublina 73',
        line2: null,
        city: 'Warszawa',
        postalCode: '20-601',
        countryIso2: 'PL',
      },
      kind: 'private',
    },
    currency: 'PLN',
    lines: [{ name: 'T-shirt', quantity: 1, unitPriceGross: 49.2, taxRate: '23' }],
    idempotencyKey: 'invoice:conn-eparagony-1:ol_order_1',
  } as unknown as Parameters<EparagonyInvoicingAdapter['issueInvoice']>[0];
}

function makeLogger(): LoggerPort {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeCredentialsResolver(
  credentials: unknown = { clientId: 'id', clientSecret: 'secret' },
): CredentialsResolverPort {
  return { get: jest.fn().mockResolvedValue(credentials) } as unknown as CredentialsResolverPort;
}

describe('EparagonyAdapterFactory', () => {
  const factory = new EparagonyAdapterFactory();
  const fetchImpl = jest.fn() as unknown as FetchLike;

  describe('createAdapters', () => {
    it('should build both the receipt lane and the invoice lane', async () => {
      const adapters = await factory.createAdapters(
        makeConnection(),
        makeCredentialsResolver(),
        makeLogger(),
        fetchImpl,
      );

      expect(adapters.fiscalization).toBeInstanceOf(EparagonyFiscalizationAdapter);
      expect(adapters.invoicing).toBeInstanceOf(EparagonyInvoicingAdapter);
    });

    it('should give both adapters the same HTTP client so one token serves both lanes', async () => {
      // THE REASON THIS METHOD RETURNS A BAG. The client owns the OAuth token
      // cache and collapses concurrent token requests into one round-trip; the
      // vendor rate-limits `/auth/token` per IP. A second client here would mean
      // a second cold cache and a second token request for the same connection.
      const adapters = await factory.createAdapters(
        makeConnection(),
        makeCredentialsResolver(),
        makeLogger(),
        fetchImpl,
      );

      // Asserted DEFINED before asserted EQUAL. `transportOf` reads a private
      // field by name, so renaming that field makes both sides `undefined` and
      // `toBe` passes vacuously - the test that names the invariant would stop
      // failing at exactly the moment it stopped being able to read it.
      expect(transportOf(adapters.fiscalization)).toBeInstanceOf(EparagonyHttpClient);
      expect(transportOf(adapters.invoicing)).toBe(transportOf(adapters.fiscalization));
    });

    it('should resolve the connection credentials exactly once for both adapters', async () => {
      const credentialsResolver = makeCredentialsResolver();

      await factory.createAdapters(
        makeConnection(),
        credentialsResolver,
        makeLogger(),
        fetchImpl,
      );

      expect(credentialsResolver.get).toHaveBeenCalledTimes(1);
      expect(credentialsResolver.get).toHaveBeenCalledWith('ref-1');
    });

    it('should thread the caller-supplied transport into the shared client', async () => {
      // `fetchImpl` is the host's connection-bound transport (#1810): a client
      // wired to `globalThis.fetch` would issue unrated traffic.
      const adapters = await factory.createAdapters(
        makeConnection(),
        makeCredentialsResolver(),
        makeLogger(),
        fetchImpl,
      );

      const client = transportOf(adapters.fiscalization) as { fetchImpl: unknown };
      expect(client.fetchImpl).toBe(fetchImpl);
    });

    it('should build the invoice lane for a receipts-only connection and refuse at CALL time', async () => {
      // The asymmetry is deliberate: `merchantTIN` is mandatory on an invoice
      // and meaningless on a receipt, and every connection shipped before #3192
      // is receipts-only. Refusing CONSTRUCTION without it would stop those
      // connections registering a single sale, so the refusal has to sit one
      // step later - which is what this asserts, rather than merely re-running
      // the default construction and checking it resolved.
      //
      // The refusal is driven for real: `issueInvoice` runs
      // `assertIssuableDocument` and `composeInvoiceDocument` before anything
      // touches the transport, so `fetchImpl` is never called and this stays a
      // construction-seam test.
      const connection = makeConnection({ config: { environment: 'sandbox', posId: 'pos-10' } });

      const adapters = await factory.createAdapters(
        connection,
        makeCredentialsResolver(),
        makeLogger(),
        fetchImpl,
      );

      expect(adapters.invoicing).toBeInstanceOf(EparagonyInvoicingAdapter);

      await expect(adapters.invoicing.issueInvoice(makeIssueCommand())).rejects.toBeInstanceOf(
        EparagonyConfigException,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('should refuse a connection with no stored credentials reference', async () => {
      const connection = makeConnection({ credentialsRef: '' });

      await expect(
        factory.createAdapters(connection, makeCredentialsResolver(), makeLogger(), fetchImpl),
      ).rejects.toBeInstanceOf(EparagonyConfigException);
    });

    it('should refuse a connection whose stored credentials carry no client secret', async () => {
      await expect(
        factory.createAdapters(
          makeConnection(),
          makeCredentialsResolver({ clientId: 'id' }),
          makeLogger(),
          fetchImpl,
        ),
      ).rejects.toBeInstanceOf(EparagonyConfigException);
    });

    it('should refuse a connection with no point-of-sale identifier', async () => {
      // Loud and early: a missing posId surfaces at the vendor as `errorCode: 43`
      // AFTER a sale has been handed over, which costs a persisted in-doubt
      // record and an operator investigation.
      const connection = makeConnection({ config: { environment: 'sandbox' } });

      await expect(
        factory.createAdapters(connection, makeCredentialsResolver(), makeLogger(), fetchImpl),
      ).rejects.toBeInstanceOf(EparagonyConfigException);
    });
  });
});
