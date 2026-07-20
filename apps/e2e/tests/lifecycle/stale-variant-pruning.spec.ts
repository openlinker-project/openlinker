/**
 * Order lifecycle: stale-variant pruning (#1495)
 *
 * Part of #1574. `MasterInventorySyncService.syncFromMasterByExternalId` soft-
 * marks (`isStale=true`) any previously-known variant absent from the
 * master's response (`InventoryService.pruneStaleVariants`,
 * libs/core/src/inventory/application/services/master-inventory-sync.service.ts).
 * Stale rows are excluded from `findAvailabilityByVariantIds` (the query
 * behind `GET /inventory/availability`), so a pruned variant reads back as 0
 * rather than its last-known quantity — deleting a variant at the master must
 * drive its OL availability, and every mapped channel's offer quantity, to 0.
 *
 * DESTRUCTIVE AND IRREVERSIBLE: this spec deletes a real PrestaShop
 * combination via the webservice (`DELETE /api/combinations/:id`) to simulate
 * "removed at the master" — there is no undo through this client. Gated behind
 * `E2E_ALLOW_DESTRUCTIVE_PRUNE=true` (mirrors the `E2E_TEST_RATE_LIMIT`
 * opt-in precedent in src/config/env.ts) so an unconfigured run of the
 * lifecycle suite never mutates the catalogue. Run only against a stack you
 * don't mind losing one variant on.
 *
 * @module tests/lifecycle
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { ApiError } from '../../src/api/api-error';
import type { Connection, Product, ProductVariant } from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
import { waitForAvailabilityValue } from '../../src/support/stock';

test.describe('lifecycle: stale-variant pruning (#1495 / #1574)', () => {
  test('deleting a variant at the master prunes OL availability + mapped channel quantity to 0', async ({
    api,
    world,
    jobs,
    poll,
    env,
  }, testInfo) => {
    test.skip(
      !env.allowDestructivePrune,
      'destructive — set E2E_ALLOW_DESTRUCTIVE_PRUNE=true on a stack you don\'t mind losing a variant on',
    );
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop connection on this stack');
    const ps = buildPrestashopClient(prestashop!);
    test.skip(!ps, 'no PrestaShop webservice key/base URL (OL_PS_WEBSERVICE_KEY / OL_PS_ADMIN_URL)');

    const candidate = await world.findMultiVariantProduct(2, { requireEans: true });
    test.skip(!candidate, 'no EAN-complete multi-variant product found');
    const product = candidate as Product;

    const detail = await api.products.getById(product.id);
    const psExternalId = externalIdFor(detail.externalIds, prestashop!.id);
    test.skip(!psExternalId, 'no PrestaShop external id mapped for the product');

    // Fresh baseline: every combination present at the master should have a
    // live (non-stale) OL availability row before we delete anything.
    await jobs.triggerAndWait(
      {
        connectionId: prestashop!.id,
        jobType: 'master.inventory.syncByExternalId',
        payload: { externalId: psExternalId, objectType: 'Product' },
      },
      { timeoutMs: 60_000 },
    );

    const combinations = await ps!.listCombinations(psExternalId!);
    expect(combinations.length, 'PrestaShop reports at least 2 combinations for a multi-variant product').toBeGreaterThanOrEqual(2);

    const variants = await world.variantsOf(product.id);
    // Pick the LAST combination (not necessarily the golden-path's primary
    // variant) so this doesn't collide with whatever full-flow.spec.ts is
    // using as its driver product's primary variant.
    const toDelete = combinations[combinations.length - 1];
    const targetVariant = variants.find((v) => (v.ean ?? v.gtin) === toDelete.ean13);
    test.skip(!targetVariant, 'could not resolve an OL variant for the combination to delete (EAN mismatch)');
    const variant = targetVariant as ProductVariant;

    testInfo.annotations.push({
      type: 'destructive-prune',
      description: `deleting PrestaShop combination ${toDelete.id} (EAN ${toDelete.ean13}) of product ${psExternalId} — irreversible`,
    });

    const before = await api.inventory.availability([variant.id]);
    expect(
      before.find((r) => r.productVariantId === variant.id)?.totalAvailable,
      'the variant has non-stale availability before deletion',
    ).toBeGreaterThan(0);

    // Resolve any live channel mapping BEFORE deletion, so we know which
    // channels to check for the post-prune 0 afterwards.
    const channelMappings: { platformType: string; mappingId: string }[] = [];
    for (const platformType of [PlatformType.allegro, PlatformType.erli]) {
      const connection = world.connectionFor(platformType);
      if (!connection) continue;
      const page = await api.listings.list({ connectionId: connection.id, internalId: variant.id, limit: 5 });
      const mapping = page.items.find((m) => m.internalId === variant.id);
      if (mapping) channelMappings.push({ platformType, mappingId: mapping.id });
    }

    // The irreversible step.
    await ps!.deleteCombination(toDelete.id);

    // Re-run the targeted master inventory sync — this is what triggers
    // `pruneStaleVariants` (the combination is now simply absent from the
    // adapter's `listInventory` response for this product).
    await jobs.triggerAndWait(
      {
        connectionId: prestashop!.id,
        jobType: 'master.inventory.syncByExternalId',
        payload: { externalId: psExternalId, objectType: 'Product' },
      },
      { timeoutMs: 60_000 },
    );

    await waitForAvailabilityValue(api, variant.id, 0, 60_000);

    if (channelMappings.length === 0) {
      testInfo.annotations.push({
        type: 'prune-channel-skip',
        description: `variant ${variant.id} had no marketplace offer mapping — channel-level prune not exercised`,
      });
      return;
    }

    await jobs.triggerAndWait(
      {
        connectionId: prestashop!.id,
        jobType: 'inventory.propagateToMarketplaces',
        payload: { productId: product.id, variantId: variant.id, inventoryUpdatedAt: new Date().toISOString() },
      },
      { timeoutMs: 120_000 },
    );

    for (const { platformType, mappingId } of channelMappings) {
      try {
        const settled = await poll.until(
          () => api.listings.getOffer(mappingId),
          (o) => o.availableQuantity === 0,
          { message: `${platformType} offer quantity to reach 0 after pruning`, timeoutMs: 120_000 },
        );
        expect(settled.availableQuantity, `${platformType} offer quantity after pruning`).toBe(0);
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          testInfo.annotations.push({
            type: 'prune-channel-degrade',
            description: `${platformType}: no OfferReader — verify quantity 0 manually`,
          });
          continue;
        }
        throw error;
      }
    }
  });
});

// ── local helpers ───────────────────────────────────────────────────────────

function externalIdFor(externalIds: Product['externalIds'], connectionId: string): string | undefined {
  return externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}

function buildPrestashopClient(connection: Connection): PrestashopWebserviceClient | null {
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl = process.env.OL_PS_ADMIN_URL?.trim() || readConfigString(connection.config, 'baseUrl');
  if (!key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = config?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
