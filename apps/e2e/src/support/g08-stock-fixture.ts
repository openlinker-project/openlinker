/**
 * G08 stock fixture
 *
 * Finds, through the API only, a multi-variant product whose every live variant
 * is owned by a PrestaShop master with a known stock count, and puts a variant's
 * stock back after a spec has corrected it. No id is hard-coded: the stack under
 * test decides what exists, and a stack without such a product makes the
 * specs skip with a stated reason instead of failing.
 *
 * Corrections written by a spec go to the real product master, so every spec
 * that changes stock restores it (see `restoreStock`) even when an assertion
 * fails first.
 *
 * @module support
 */
import { randomUUID } from 'node:crypto';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import type { Product, StockCorrectionTarget } from '../api/api.types';

export interface StockFixtureVariant {
  id: string;
  sku: string | null;
  /** `sku ?? id`: the suffix every stock test id carries. */
  key: string;
  /** The master's count when the fixture was found (the value to restore). */
  quantity: number;
}

export interface StockFixture {
  productId: string;
  productName: string;
  connectionName: string;
  variants: StockFixtureVariant[];
}

/** Products scanned before giving up; bounds the lookup on a large catalogue. */
const MAX_PRODUCTS_SCANNED = 60;
const LIST_PAGE_SIZE = 30;

/** A fresh idempotency key. One per request: a reused key is a different test. */
export function freshIdempotencyKey(): string {
  return randomUUID();
}

async function readTarget(api: ApiClient, variantId: string): Promise<StockCorrectionTarget | null> {
  try {
    return await api.inventory.correctionTarget(variantId);
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

async function fixtureFor(api: ApiClient, listed: Product): Promise<StockFixture | null> {
  const product = await api.products.getById(listed.id);
  const live = (product.variants ?? []).filter((variant) => variant.isStale !== true);
  if (live.length < 2) return null;

  const variants: StockFixtureVariant[] = [];
  let connectionName = '';
  for (const variant of live) {
    const target = await readTarget(api, variant.id);
    if (
      target === null ||
      target.kind !== 'ready' ||
      target.platformType !== 'prestashop' ||
      target.currentQuantity === null
    ) {
      return null;
    }
    connectionName = target.connectionName ?? connectionName;
    variants.push({
      id: variant.id,
      sku: variant.sku,
      key: variant.sku ?? variant.id,
      quantity: target.currentQuantity,
    });
  }
  return { productId: product.id, productName: product.name, connectionName, variants };
}

/**
 * A variant needs this much stock for a +3 or -1 correction to stay under the
 * large-change rule (more than 50 units or more than half the current count).
 */
export const COMFORTABLE_STOCK = 10;

/** The most stock any variant of the fixture holds. */
export function stockiest(fixture: StockFixture): StockFixtureVariant {
  return fixture.variants.reduce((a, b) => (b.quantity > a.quantity ? b : a));
}

/**
 * The first multi-variant product with a PrestaShop-owned count per variant,
 * preferring one whose stockiest variant holds `COMFORTABLE_STOCK`; otherwise
 * the first match, or `null`.
 */
export async function findStockFixture(api: ApiClient): Promise<StockFixture | null> {
  let fallback: StockFixture | null = null;
  let scanned = 0;
  for (let offset = 0; scanned < MAX_PRODUCTS_SCANNED; offset += LIST_PAGE_SIZE) {
    const page = await api.products.list({ limit: LIST_PAGE_SIZE, offset });
    if (page.items.length === 0) return null;
    for (const product of page.items) {
      scanned += 1;
      if ((product.variantCount ?? 0) < 2) continue;
      const fixture = await fixtureFor(api, product);
      if (!fixture) continue;
      if (stockiest(fixture).quantity >= COMFORTABLE_STOCK) return fixture;
      fallback ??= fixture;
    }
    if (offset + LIST_PAGE_SIZE >= page.total) break;
  }
  return fallback;
}

export const SKIP_NO_FIXTURE =
  'No multi-variant product with a PrestaShop-owned stock count was found on this stack.';

/**
 * Put every fixture variant back to the count it had when the fixture was
 * found. A `no-change` refusal means the master already holds that number, so
 * it is the success case here, not an error.
 */
export async function restoreStock(api: ApiClient, fixture: StockFixture): Promise<void> {
  for (const variant of fixture.variants) {
    const target = await api.inventory.correctionTarget(variant.id);
    if (target.currentQuantity === variant.quantity) continue;
    const outcome = await api.inventory.correct(variant.id, {
      mode: 'set',
      quantity: variant.quantity,
      operatorReason: 'count_correction',
      note: 'G08 e2e restore',
      idempotencyKey: freshIdempotencyKey(),
      confirmLargeChange: true,
    });
    if (outcome.kind === 'conflict' && outcome.conflict.code !== 'no-change') {
      throw new Error(
        `Could not restore stock for ${variant.key}: ${JSON.stringify(outcome.conflict)}`,
      );
    }
    if (outcome.kind === 'result' && outcome.result.status !== 'applied') {
      throw new Error(`Restoring stock for ${variant.key} ended ${outcome.result.status}`);
    }
  }
}
