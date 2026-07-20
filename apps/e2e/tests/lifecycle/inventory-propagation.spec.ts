/**
 * Order lifecycle: cross-channel stock propagation + oversell safety
 *
 * Part of #1574. A single master stock change must fan out to every mapped
 * marketplace offer (Allegro, Erli) and shop-published product (WooCommerce,
 * #1508) in one `inventory.propagateToMarketplaces` pass
 * (`InventoryPropagateToMarketplacesHandler`,
 * docs/architecture-overview.md § Inventory). Propagation writes an ABSOLUTE
 * quantity from master (never a per-channel relative decrement), which is
 * exactly what makes overselling impossible: once master reads 0, every
 * mapped channel converges to 0 — none can be left stranded at a stale
 * positive value another channel already sold into.
 *
 * This spec drives that fan-out twice against a REAL existing multi-variant
 * product (reuses whatever golden-path/operator-setup runs already created —
 * no bulk-offer-wizard UI driving here, to avoid duplicating that large
 * surface; a stack with no such offers yet degrades to annotated skips per
 * channel):
 *   1. Master stock -1 (via a real PrestaShop stock write + a real master
 *      inventory sync) -> assert every live channel converges to the SAME new
 *      quantity.
 *   2. Master stock -> 0 (the oversell-safety proof: an out-of-stock variant
 *      lists as 0 on EVERY channel, not left non-zero on a channel that
 *      hasn't "seen" the second sale) -> assert every live channel converges
 *      to exactly 0.
 * PrestaShop stock is restored to its original value in `afterAll` so the
 * spec is non-destructive on a shared stack.
 *
 * Self-configuring: skips when there's no PrestaShop connection/webservice
 * key (needed to move real stock) or no EAN-complete multi-variant product.
 * Per-channel assertions degrade to an annotation when the picked variant has
 * no offer mapping on that connection yet, or the channel has no live
 * OfferReader (Erli) / no stock write-back (WooCommerce, per S9 in
 * full-flow.spec.ts) — mirroring the golden path's own degrade conventions.
 *
 * @module tests/lifecycle
 */
import type { TestInfo } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import { PlatformType, type World } from '../../src/world/world';
import type { ApiClient } from '../../src/api/api-client';
import { ApiError } from '../../src/api/api-error';
import type { Connection, MarketplaceOffer, Product, ProductVariant } from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
import { waitForAvailabilityValue } from '../../src/support/stock';
import type { SyncJobs } from '../../src/support/jobs';
import type { Poller } from '../../src/support/poller';

test.describe.configure({ mode: 'serial' });

test.describe('lifecycle: cross-channel stock propagation + oversell safety (#1574)', () => {
  let prestashop: Connection | undefined;
  let ps: PrestashopWebserviceClient | null = null;
  let product: Product | undefined;
  let variant: ProductVariant | undefined;
  let psExternalId: string | undefined;
  let originalPsStock: number | null = null;

  test.beforeAll(async ({ api, world }) => {
    prestashop = world.connectionFor(PlatformType.prestashop);
    ps = buildPrestashopClient(world);
    if (!prestashop || !ps) return;

    const candidate = await world.findMultiVariantProduct(2, { requireEans: true });
    if (!candidate) return;
    const detail = await api.products.getById(candidate.id);
    const externalId = externalIdFor(detail.externalIds, prestashop.id);
    if (!externalId) return;

    const variants = await world.variantsOf(candidate.id);
    const primary = variants.find((v) => v.ean ?? v.gtin);
    if (!primary) return;

    product = candidate;
    variant = primary;
    psExternalId = externalId;
    originalPsStock = await ps.getStockForProduct(externalId);
  });

  test.afterAll(async () => {
    // Best-effort restore — never destructive on a shared stack.
    if (ps && psExternalId && originalPsStock !== null) {
      await ps.setStock(psExternalId, originalPsStock).catch(() => undefined);
    }
  });

  test('one master stock change fans out to every mapped channel', async ({ api, world, jobs, poll }, testInfo) => {
    test.skip(!prestashop || !ps, 'no PrestaShop connection/webservice key on this stack');
    test.skip(!product || !variant || !psExternalId, 'no EAN-complete multi-variant product found');
    expect(originalPsStock, 'baseline PrestaShop stock was captured').not.toBeNull();

    const targets = await resolveChannelTargets(api, world, variant!.id);
    if (targets.length === 0) {
      testInfo.annotations.push({
        type: 'propagation-skip',
        description: `variant ${variant!.id} has no marketplace offer mapping yet — run golden-path/operator-setup first for full coverage`,
      });
    }

    const steppedDown = Math.max(originalPsStock! - 2, 1);
    await syncMasterStock(ps!, jobs, prestashop!.id, psExternalId!, steppedDown);
    await waitForAvailabilityValue(api, variant!.id, steppedDown, 120_000);
    await propagateAndAssertChannels(api, jobs, poll, prestashop!.id, product!.id, variant!.id, targets, steppedDown, testInfo);
  });

  test('driving master to 0 drives EVERY mapped channel to 0 (oversell safety)', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    test.skip(!prestashop || !ps, 'no PrestaShop connection/webservice key on this stack');
    test.skip(!product || !variant || !psExternalId, 'no EAN-complete multi-variant product found');

    const targets = await resolveChannelTargets(api, world, variant!.id);
    if (targets.length === 0) {
      testInfo.annotations.push({
        type: 'propagation-skip',
        description: `variant ${variant!.id} has no marketplace offer mapping — oversell-safety check degraded to master-only`,
      });
    }

    await syncMasterStock(ps!, jobs, prestashop!.id, psExternalId!, 0);
    await waitForAvailabilityValue(api, variant!.id, 0, 120_000);
    // Master is authoritative INCLUDING 0 (#824) — every channel must converge
    // to exactly 0, never be left stranded at a stale positive quantity.
    await propagateAndAssertChannels(api, jobs, poll, prestashop!.id, product!.id, variant!.id, targets, 0, testInfo);
  });
});

// ── local helpers ───────────────────────────────────────────────────────────

interface ChannelTarget {
  platformType: string;
  connectionId: string;
  mappingId: string;
}

/** Resolve the variant's offer mapping on every marketplace connection that has one. */
async function resolveChannelTargets(
  api: ApiClient,
  world: World,
  variantId: string,
): Promise<ChannelTarget[]> {
  const targets: ChannelTarget[] = [];
  for (const platformType of [PlatformType.allegro, PlatformType.erli]) {
    const connection = world.connectionFor(platformType);
    if (!connection) continue;
    const page = await api.listings.list({ connectionId: connection.id, internalId: variantId, limit: 5 });
    const mapping = page.items.find((m) => m.internalId === variantId);
    if (mapping) targets.push({ platformType, connectionId: connection.id, mappingId: mapping.id });
  }
  return targets;
}

/** Push a new PrestaShop stock value, then run the targeted master inventory sync. */
async function syncMasterStock(
  ps: PrestashopWebserviceClient,
  jobs: SyncJobs,
  prestashopConnectionId: string,
  psExternalId: string,
  newStock: number,
): Promise<void> {
  await ps.setStock(psExternalId, newStock);
  await jobs.triggerAndWait(
    {
      connectionId: prestashopConnectionId,
      jobType: 'master.inventory.syncByExternalId',
      payload: { externalId: psExternalId, objectType: 'Product' },
    },
    { timeoutMs: 60_000 },
  );
}

/** Trigger cross-channel propagation and assert every resolved channel converges to `expectedQty`. */
async function propagateAndAssertChannels(
  api: ApiClient,
  jobs: SyncJobs,
  poll: Poller,
  anchorConnectionId: string,
  productId: string,
  variantId: string,
  targets: ChannelTarget[],
  expectedQty: number,
  testInfo: TestInfo,
): Promise<void> {
  await jobs.triggerAndWait(
    {
      connectionId: anchorConnectionId,
      jobType: 'inventory.propagateToMarketplaces',
      payload: { productId, variantId, inventoryUpdatedAt: new Date().toISOString() },
    },
    { timeoutMs: 120_000 },
  );

  for (const target of targets) {
    const offer = await readLiveOfferOrNull(api, target.mappingId);
    if (offer === null) {
      testInfo.annotations.push({
        type: 'propagation-degrade',
        description: `${target.platformType}: no OfferReader (mapping-level only) — verify quantity ${expectedQty} manually`,
      });
      continue;
    }
    const settled = await poll.until(
      () => api.listings.getOffer(target.mappingId),
      (o) => o.availableQuantity === expectedQty,
      {
        message: `${target.platformType} offer quantity to converge to ${expectedQty}`,
        timeoutMs: 120_000,
      },
    );
    expect(settled.availableQuantity, `${target.platformType} offer quantity`).toBe(expectedQty);
  }

  // WooCommerce: only a real fan-out target when stock write-back is enabled
  // for the connection (OfferManager on a non-inventory-master WC connection,
  // #1498) — off by default, so a stale value here is an annotated known gap,
  // never a hard failure (mirrors full-flow.spec.ts S9).
  testInfo.annotations.push({
    type: 'propagation-wc',
    description:
      'WooCommerce fan-out requires stock write-back enabled (OfferManager on the WC connection, ' +
      'off by default) — not asserted here; see full-flow.spec.ts S9 for the same documented gap',
  });
}

/**
 * Live-offer read guarded by capability: `GET /listings/:id/offer` 422s when
 * the connection's adapter ships no `OfferReader` (Erli today).
 */
async function readLiveOfferOrNull(api: ApiClient, mappingId: string): Promise<MarketplaceOffer | null> {
  try {
    return await api.listings.getOffer(mappingId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) return null;
    throw error;
  }
}

function externalIdFor(externalIds: Product['externalIds'], connectionId: string): string | undefined {
  return externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}

function buildPrestashopClient(world: World): PrestashopWebserviceClient | null {
  const connection = world.connectionFor(PlatformType.prestashop);
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl = process.env.OL_PS_ADMIN_URL?.trim() || readConfigString(connection?.config, 'baseUrl');
  if (!connection || !key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = config?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
