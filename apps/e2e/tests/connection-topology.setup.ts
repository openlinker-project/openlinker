/**
 * Connection-topology preflight
 *
 * Runs in the `setup` project, so EVERY browser project depends on it: a stack
 * whose connections contradict themselves fails here, once, with a readable
 * reason — instead of surfacing hours later as an unrelated-looking failure
 * deep in a suite.
 *
 * Why this exists. A live run found `WooCommerce (shop)` declaring
 * `config.masterCatalogConnectionId` (its catalogue comes from PrestaShop)
 * while ALSO enabling `ProductMaster` / `InventoryMaster`. Publishing a product
 * to that shop then let its own master sync re-import the copy as a SECOND
 * OpenLinker product. The consequences were not test-shaped:
 *
 *   - a real marketplace order could not be created on the shop
 *     ("No WC product mapping for OL product …"), because the offer was built
 *     from one OL product and the shop copy was filed under the other;
 *   - the bulk product picker matched two rows for one SKU and stalled.
 *
 * Nothing in the product forbids that combination, so the check lives here
 * rather than as a runtime guard.
 *
 * @module tests
 */
import { test as setup, expect } from '@playwright/test';
import { ApiClient } from '../src/api/api-client';
import { resolveEnv } from '../src/config/env';
import type { Connection } from '../src/api/api.types';

/** Roles that make a connection an authoritative catalogue/stock source. */
const MASTER_ROLES = ['ProductMaster', 'InventoryMaster'] as const;

function siteUrlOf(connection: Connection): string | null {
  const config = connection.config ?? {};
  for (const key of ['siteUrl', 'baseUrl', 'shopUrl']) {
    const value = config[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

setup('connections are configured coherently enough to test', async () => {
  const env = resolveEnv();
  const api = new ApiClient({ baseUrl: env.apiUrl });
  await api.login(env.adminUser, env.adminPass);

  const connections = (await api.connections.list()).filter((c) => c.status === 'active');
  const problems: string[] = [];
  const notes: string[] = [];

  // 1. Self-contradiction: "my catalogue comes from X" + "I am a catalogue".
  //    This is the one that corrupts real order flow, so it is a hard failure.
  for (const connection of connections) {
    const masterRef = connection.config?.['masterCatalogConnectionId'];
    if (typeof masterRef !== 'string' || masterRef.length === 0) continue;
    const ownMasterRoles = MASTER_ROLES.filter((role) =>
      connection.enabledCapabilities.includes(role),
    );
    if (ownMasterRoles.length > 0) {
      problems.push(
        `"${connection.name}" points at another connection as its master catalogue ` +
          `(masterCatalogConnectionId=${masterRef}) yet also enables ${ownMasterRoles.join(' + ')}. ` +
          `Its own sync will re-import products published to it as NEW OpenLinker products, ` +
          `splitting one product in two. Remove ${ownMasterRoles.join(' / ')} from this connection.`,
      );
    }
  }

  // 2. More than one catalogue master is legal but ambiguous for a suite that
  //    says "the master" — recorded, not enforced.
  const productMasters = connections.filter((c) => c.enabledCapabilities.includes('ProductMaster'));
  if (productMasters.length > 1) {
    notes.push(
      `${productMasters.length} connections enable ProductMaster (${productMasters
        .map((c) => c.name)
        .join(', ')}) — specs resolving "the master catalogue" by capability may pick either.`,
    );
  }
  if (productMasters.length === 0) {
    problems.push('No active connection enables ProductMaster — nothing can seed the catalogue.');
  }

  // 3. Two connections on the SAME store, one ingesting orders and one
  //    receiving them, form a feedback loop: every order OpenLinker writes
  //    reappears in the source feed and is ingested again. Legitimate for the
  //    order-destination scenario (there is only one test store), so recorded.
  const byStore = new Map<string, Connection[]>();
  for (const connection of connections) {
    const site = siteUrlOf(connection);
    if (!site) continue;
    byStore.set(site, [...(byStore.get(site) ?? []), connection]);
  }
  for (const [site, group] of byStore) {
    if (group.length < 2) continue;
    const sources = group.filter((c) => c.enabledCapabilities.includes('OrderSource'));
    const destinations = group.filter((c) =>
      c.enabledCapabilities.includes('OrderProcessorManager'),
    );
    if (sources.length > 0 && destinations.length > 0) {
      notes.push(
        `${group.length} active connections share the store ${site}, with both order ingestion ` +
          `and order creation enabled — orders OpenLinker creates there will be re-ingested. ` +
          `Match ingested orders by their source id, never by "the newest order".`,
      );
    }
  }

  for (const note of notes) {
    setup.info().annotations.push({ type: 'topology', description: note });
  }

  expect(
    problems,
    `Connection topology cannot support an E2E run:\n- ${problems.join('\n- ')}`,
  ).toEqual([]);
});
