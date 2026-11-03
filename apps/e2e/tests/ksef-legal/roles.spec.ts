/**
 * ksef-legal: what a non-admin learns about a KSeF connection (DEF-02)
 *
 * The verification link needs the connection's environment, and a viewer may
 * see the QR. The environment therefore travels as `publicConfig.env` - the
 * only key the KSeF manifest declares public - and the raw `config` (seller
 * address, payment details) stays admin-only.
 *
 * @module tests/ksef-legal
 */
import { test, expect } from '../../src/fixtures/test';
import { provisionViewer, sweepProvisionedAccounts } from '../../src/support/access-control';
import { requireKsef } from './ksef-legal.helpers';

test.describe('ksef-legal: public config for non-admins', () => {
  test('a viewer reads publicConfig.env and nothing else of the config', async ({
    api,
    env,
    world,
  }) => {
    const ksef = requireKsef(world);
    const viewer = await provisionViewer(env, api);
    test.skip(
      !viewer,
      'this stack hands out no viewer account (registration closed or demo confirmation)'
    );
    try {
      const seen = (await viewer!.client.connections.getById(ksef.id)) as unknown as {
        publicConfig?: Record<string, unknown>;
        config?: unknown;
      };
      expect(seen.publicConfig).toEqual({ env: String(ksef.config?.['env']) });
      // Deny-by-default projects an EMPTY object for a non-admin outside demo
      // mode (connection-response.dto.ts), so nothing of the raw config leaks.
      expect(seen.config ?? {}, 'no raw config for a viewer').toEqual({});
    } finally {
      await sweepProvisionedAccounts(api);
    }
  });
});
