/**
 * Fetches Amazon's official SP-API Swagger models, pinned to one commit of
 * amzn/selling-partner-api-models, into `.models/` (gitignored, never vendored).
 * The fake server validates every request and response against them.
 *
 *   node apps/e2e/src/fakes/amazon-spapi/fetch-models.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = '9047916fede443a856e4802a68b322d7eada89ef';
const FILES = [
  'catalog-items-api-model/catalogItems_2022-04-01',
  'fba-inventory-api-model/fbaInventory',
  'feeds-api-model/feeds_2021-06-30',
  'fulfillment-outbound-api-model/fulfillmentOutbound_2020-07-01',
  'listings-items-api-model/listingsItems_2021-08-01',
  'notifications-api-model/notifications',
  'orders-api-model/ordersV0',
  'orders-api-model/orders_2026-01-01',
  'product-type-definitions-api-model/definitionsProductTypes_2020-09-01',
  'reports-api-model/reports_2021-06-30',
  'sellers-api-model/sellers',
];
const out = resolve(dirname(fileURLToPath(import.meta.url)), '.models');
mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const name = f.split('/').pop();
  const target = resolve(out, `${name}.json`);
  if (existsSync(target)) continue;
  const res = await fetch(`https://raw.githubusercontent.com/amzn/selling-partner-api-models/${SHA}/models/${f}.json`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  writeFileSync(target, await res.text());
  console.log('fetched', name);
}
