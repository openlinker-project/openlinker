/**
 * WooCommerce parity — scenario 8: connection config-shape validation (#1505)
 * and stock write-back mutual exclusivity (#1508)
 *
 * Both checks run entirely at connection-create time and reject before any
 * credential row or connection row is persisted, so these tests need no
 * existing WooCommerce connection on the stack and leave no cleanup behind
 * on either assertion path (both expect a 400, i.e. nothing gets created).
 *
 * Grounded in `apps/api/src/integrations/application/services/connection
 * .service.ts`: `assertNoWriteBackAuthorityConflict` runs BEFORE config-shape
 * validation, so the mutual-exclusivity test uses a config that would
 * otherwise be valid, and the config-shape test uses capabilities that don't
 * trip the exclusivity guard.
 *
 * @module tests/woocommerce-parity
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import type { ApiError } from '../../src/api/api-error';
import type { ApiClient } from '../../src/api/api-client';

test.describe('WooCommerce connection config validation', () => {
  test('a malformed masterCatalogConnectionId is rejected with a readable error list', async ({ api }) => {
    const error = await expectCreateRejected(api, {
      name: `E2E WC config-validation ${randomUUID().slice(0, 8)}`,
      platformType: 'woocommerce',
      config: { siteUrl: 'https://e2e-wc-config-test.invalid', masterCatalogConnectionId: 'not-a-uuid' },
      credentials: { consumerKey: 'ck_e2e_test', consumerSecret: 'cs_e2e_test' },
      enabledCapabilities: ['ProductMaster'],
    });

    expect(error.status, `expected 400, got ${error.status}: ${JSON.stringify(error.body)}`).toBe(400);
    const body = error.body as { message?: string; errors?: Array<{ path?: string; message?: string }> };
    expect(body.errors, 'error body carries a structured errors[] list').toBeTruthy();
    expect(
      body.errors?.some((e) => (e.path ?? '').includes('masterCatalogConnectionId')),
      `expected an error entry for masterCatalogConnectionId, got: ${JSON.stringify(body.errors)}`,
    ).toBe(true);
  });

  test('InventoryMaster and stock write-back (OfferManager) are mutually exclusive on one connection', async ({
    api,
  }) => {
    const error = await expectCreateRejected(api, {
      name: `E2E WC exclusivity-validation ${randomUUID().slice(0, 8)}`,
      platformType: 'woocommerce',
      config: { siteUrl: 'https://e2e-wc-config-test.invalid' },
      credentials: { consumerKey: 'ck_e2e_test', consumerSecret: 'cs_e2e_test' },
      enabledCapabilities: ['InventoryMaster', 'OfferManager'],
    });

    expect(error.status, `expected 400, got ${error.status}: ${JSON.stringify(error.body)}`).toBe(400);
    const body = error.body as { message?: string };
    expect(
      body.message ?? '',
      'error message names both conflicting capabilities',
    ).toMatch(/InventoryMaster.*OfferManager|OfferManager.*InventoryMaster/s);
  });
});

/**
 * Assert `api.connections.create(input)` is rejected and return the thrown
 * `ApiError`. If creation unexpectedly succeeds, best-effort disable the
 * created connection (there is no delete endpoint) before failing loudly —
 * an unexpectedly-accepted invalid config must never leave a live connection
 * behind on the stack.
 */
async function expectCreateRejected(
  api: ApiClient,
  input: Parameters<ApiClient['connections']['create']>[0],
): Promise<ApiError> {
  let created: Awaited<ReturnType<ApiClient['connections']['create']>> | undefined;
  try {
    created = await api.connections.create(input);
  } catch (error) {
    return error as ApiError;
  }
  await api.connections.update(created.id, { status: 'disabled' }).catch(() => undefined);
  throw new Error(
    `Expected connection creation to be rejected (400), but it succeeded and was created as ${created.id} ` +
      '(best-effort disabled).',
  );
}
