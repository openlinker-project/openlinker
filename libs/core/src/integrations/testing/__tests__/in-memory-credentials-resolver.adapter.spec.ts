/**
 * InMemoryCredentialsResolverAdapter Tests
 *
 * @module libs/core/src/integrations/testing
 */
import { InMemoryCredentialsResolverAdapter } from '../in-memory-credentials-resolver.adapter';

describe('InMemoryCredentialsResolverAdapter', () => {
  it('should return the seeded credentials for a known ref', async () => {
    const resolver = new InMemoryCredentialsResolverAdapter({
      'env:ALLEGRO_TOKEN': { token: 'abc123' },
    });

    const credentials = await resolver.get<{ token: string }>('env:ALLEGRO_TOKEN');

    expect(credentials).toEqual({ token: 'abc123' });
  });

  it('should narrow the return type via the generic parameter', async () => {
    interface PrestashopCreds {
      apiKey: string;
      baseUrl: string;
    }
    const resolver = new InMemoryCredentialsResolverAdapter({
      'env:PS_CREDS': { apiKey: 'k', baseUrl: 'https://shop.example' } satisfies PrestashopCreds,
    });

    const creds = await resolver.get<PrestashopCreds>('env:PS_CREDS');

    expect(creds.apiKey).toBe('k');
    expect(creds.baseUrl).toBe('https://shop.example');
  });

  it('should throw with a descriptive message when the ref is missing', async () => {
    const resolver = new InMemoryCredentialsResolverAdapter();

    await expect(resolver.get('env:MISSING')).rejects.toThrow(
      /Credentials not found for ref: env:MISSING/,
    );
  });

  it('should pick up credentials seeded via seed() after construction', async () => {
    const resolver = new InMemoryCredentialsResolverAdapter();

    resolver.seed('env:LATER', 'value-added-later');

    expect(await resolver.get('env:LATER')).toBe('value-added-later');
  });

  it('should make subsequent get() calls throw after clear()', async () => {
    const resolver = new InMemoryCredentialsResolverAdapter({ 'env:X': 'y' });

    resolver.clear();

    await expect(resolver.get('env:X')).rejects.toThrow(/not found/);
  });
});
