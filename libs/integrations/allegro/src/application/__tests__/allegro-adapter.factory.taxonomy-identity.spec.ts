/**
 * Allegro Adapter Factory — taxonomy identity threading (#2063)
 *
 * The adapter's `environment` constructor param is OPTIONAL (so the 13 existing
 * adapter-spec construction sites keep compiling) and defaults to
 * `'production'`. That makes a forgotten argument at the factory call site
 * type-check cleanly while silently scoping every sandbox connection's category
 * tree onto the production owner — precisely the #2063 defect, reintroduced.
 *
 * So the threading itself is asserted here, end to end through
 * `createAdapters`, rather than trusting the compiler.
 *
 * @module libs/integrations/allegro/src/application/__tests__
 */
import { AllegroAdapterFactory } from '../allegro-adapter.factory';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { isTaxonomyIdentityProvider } from '@openlinker/core/listings';
import type { FetchLike } from '@openlinker/shared/http';

describe('AllegroAdapterFactory — taxonomy identity', () => {
  const identifierMapping = {} as IdentifierMappingPort;
  const fetchImpl = jest.fn() as unknown as FetchLike;

  const credentialsResolver = {
    get: jest.fn().mockResolvedValue({ accessToken: 'token', refreshToken: 'refresh' }),
  } as unknown as CredentialsResolverPort;

  const makeConnection = (environment: 'sandbox' | 'production'): Connection =>
    ({
      id: `connection-${environment}`,
      platformType: 'allegro',
      credentialsRef: 'ref',
      config: { environment },
    }) as unknown as Connection;

  const resolveIdentity = async (environment: 'sandbox' | 'production'): Promise<string> => {
    const { offerManager } = await new AllegroAdapterFactory().createAdapters(
      makeConnection(environment),
      identifierMapping,
      credentialsResolver,
      fetchImpl
    );

    if (!isTaxonomyIdentityProvider(offerManager)) {
      throw new Error('offer-manager adapter does not declare TaxonomyIdentityProvider');
    }
    return offerManager.getTaxonomyIdentity();
  };

  it('should scope a sandbox connection to the allegro:sandbox taxonomy', async () => {
    await expect(resolveIdentity('sandbox')).resolves.toBe('allegro:sandbox');
  });

  it('should scope a production connection to the allegro taxonomy', async () => {
    await expect(resolveIdentity('production')).resolves.toBe('allegro');
  });
});
