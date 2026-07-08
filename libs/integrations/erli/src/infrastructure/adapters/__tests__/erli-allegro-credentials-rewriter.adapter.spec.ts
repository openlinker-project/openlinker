/**
 * Erli Allegro-Credentials-Reuse Rewriter Tests (#1387, ADR-031)
 *
 * Asserts the `reuseAllegroConnectionId` shape resolves server-side into a
 * concrete `allegroClientId`/`allegroClientSecret` pair, so the raw Allegro
 * `clientSecret` is never serialized into an HTTP response body; and that a
 * payload without `reuseAllegroConnectionId` passes through unchanged.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import { ConnectionCredentialsRewriteException } from '@openlinker/core/integrations';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { ErliAllegroCredentialsRewriterAdapter } from '../erli-allegro-credentials-rewriter.adapter';

function buildAllegroConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'allegro-conn-1',
    platformType: 'allegro',
    name: 'Main Allegro Store',
    status: 'active',
    config: {},
    credentialsRef: 'db:allegro-cred-ref-1',
    ...overrides,
  } as Connection;
}

describe('ErliAllegroCredentialsRewriterAdapter', () => {
  let connectionPort: jest.Mocked<Pick<ConnectionPort, 'get'>>;
  let credentialsResolver: jest.Mocked<CredentialsResolverPort>;
  let adapter: ErliAllegroCredentialsRewriterAdapter;

  beforeEach(() => {
    connectionPort = { get: jest.fn() };
    credentialsResolver = { get: jest.fn() };
    adapter = new ErliAllegroCredentialsRewriterAdapter(
      connectionPort as unknown as ConnectionPort,
      credentialsResolver
    );
  });

  it('should return the credentials unchanged when reuseAllegroConnectionId is absent', async () => {
    const result = await adapter.rewrite({ apiKey: 'unchanged' });

    expect(result).toEqual({ apiKey: 'unchanged' });
    expect(connectionPort.get).not.toHaveBeenCalled();
  });

  it('should copy clientId/clientSecret from the source Allegro connection, dropping reuseAllegroConnectionId', async () => {
    connectionPort.get.mockResolvedValue(buildAllegroConnection());
    credentialsResolver.get.mockResolvedValue({
      clientId: 'reused-client-id',
      clientSecret: 'reused-client-secret',
    });

    const result = await adapter.rewrite({
      apiKey: 'keep-me',
      reuseAllegroConnectionId: 'allegro-conn-1',
    });

    expect(connectionPort.get).toHaveBeenCalledWith('allegro-conn-1');
    expect(credentialsResolver.get).toHaveBeenCalledWith('db:allegro-cred-ref-1');
    expect(result).toEqual({
      apiKey: 'keep-me',
      allegroClientId: 'reused-client-id',
      allegroClientSecret: 'reused-client-secret',
    });
  });

  it('should reject a blank reuseAllegroConnectionId', async () => {
    await expect(adapter.rewrite({ reuseAllegroConnectionId: '   ' })).rejects.toThrow(
      ConnectionCredentialsRewriteException
    );
    expect(connectionPort.get).not.toHaveBeenCalled();
  });

  it('should reject when the source connection id does not resolve to an existing connection', async () => {
    connectionPort.get.mockRejectedValue(new ConnectionNotFoundException('does-not-exist'));

    await expect(
      adapter.rewrite({ reuseAllegroConnectionId: 'does-not-exist' })
    ).rejects.toThrow(/does not exist/);
  });

  it('should reject when the source connection is not an Allegro connection', async () => {
    connectionPort.get.mockResolvedValue(
      buildAllegroConnection({ id: 'other-conn-1', platformType: 'prestashop' })
    );

    await expect(
      adapter.rewrite({ reuseAllegroConnectionId: 'other-conn-1' })
    ).rejects.toThrow(/is not an Allegro connection/);
  });

  it('should reject when the source Allegro connection has no client credentials configured', async () => {
    connectionPort.get.mockResolvedValue(buildAllegroConnection());
    credentialsResolver.get.mockResolvedValue({});

    await expect(
      adapter.rewrite({ reuseAllegroConnectionId: 'allegro-conn-1' })
    ).rejects.toThrow(/does not have app client credentials/);
  });

  it('should propagate unexpected errors from ConnectionPort.get unchanged', async () => {
    const unexpected = new Error('db unavailable');
    connectionPort.get.mockRejectedValue(unexpected);

    await expect(adapter.rewrite({ reuseAllegroConnectionId: 'allegro-conn-1' })).rejects.toThrow(
      unexpected
    );
  });
});
