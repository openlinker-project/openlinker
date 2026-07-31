/**
 * Golden path full-flow: S0 — baseline
 *
 * Sync the master catalogue, pick the driver product and snapshot stock.
 *
 * Segment of the attended S0-S9 flow across all six systems. The segments share
 * `state` and run in file order in one worker — see `./segment.ts` for the
 * ordering, fail-fast and attended-gate contract, and
 * `docs/manual-testing/e2e-golden-path.md` for the flow itself.
 *
 * WARNING: MUTATING and ATTENDED. Run only via
 * `pnpm --filter @openlinker/e2e test:e2e:full-flow`, in a coordinated session
 * against a stack you control.
 *
 * @module tests/golden-path/full-flow
 */
import { test, expect } from '../../../src/fixtures/test';
import { PlatformType } from '../../../src/world/world';
import type { Product } from '../../../src/api/api.types';
import { captureStock } from '../../../src/support/stock';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { skipWhenResuming, externalIdFor, resolveSourceConnection, pickDriverProduct, provisionFreshProduct } from './helpers';

fullFlowSegment(() => {
  test('S0 — baseline: sync master catalogue and snapshot stock', async ({ api, world, jobs, poll, env }) => {
    skipWhenResuming(env);
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop connection on this stack');

    // E3 (opt-in): provision a BRAND-NEW master product BEFORE the catalogue
    // sync, so `master.product.syncAll` imports it and the whole run creates
    // fresh offers/order rather than reusing existing state. The generated SKU
    // becomes the pin, so selection flows through the deterministic pin path.
    let pinnedSku = env.productSku;
    // The real PS category the fresh product lands in — resolved at provision
    // time so S0 can map exactly that category (not the Home default) to Allegro.
    let freshCategoryPsId: string | undefined;
    // Per-combination barcodes of the fresh product, asserted against OL's import
    // below so a silent fall-back to a single synthetic variant can't pass S0.
    let freshVariantEans: string[] = [];
    if (env.freshProduct) {
      const provisioned = await provisionFreshProduct(world, { variantCount: env.freshVariantCount });
      pinnedSku = provisioned.sku;
      freshCategoryPsId = provisioned.prestashopCategoryId;
      freshVariantEans = provisioned.variantEans;
    }

    const job = await jobs.triggerAndWait(
      { connectionId: prestashop!.id, jobType: 'master.product.syncAll' },
      { timeoutMs: 180_000 },
    );
    expect(job.status).toBe('succeeded');

    // Pick the driver product. Default (E1): the first EAN-complete multi-variant
    // product whose primary variant ALSO has an ACTIVE, mapped marketplace offer
    // on the purchase source — a draft/inactive offer would strand S3, the
    // purchase and S5. Falls back to the first EAN-complete multi-variant product
    // when none has an active offer yet (a fresh stack where S3/S4 create them).
    // The flow maps offers and resolves orders by barcode, so an EAN-less pick
    // (demo "Resin Ring") is never chosen. Override with E2E_PRODUCT_SKU to pin a
    // specific product by SKU (single-variant allowed) — the deterministic escape
    // hatch when the heuristic picks a non-purchasable product.
    const source = resolveSourceConnection(world, env.sourcePlatform);
    const product = (await poll.until<Product | undefined>(
      () => pickDriverProduct({ api, world, pinnedSku, source }),
      (p) => !!p,
      {
        message: pinnedSku
          ? `pinned product (SKU ${pinnedSku}) to appear after PrestaShop sync`
          : 'an EAN-complete multi-variant product with an active offer to appear after PrestaShop sync',
        timeoutMs: 60_000,
      },
    ))!;
    if (pinnedSku) {
      expect(product.sku, `pinned product SKU (E2E_PRODUCT_SKU=${pinnedSku})`).toBe(pinnedSku);
    }
    const variants = await world.variantsOf(product.id);
    const primary = variants.find((v) => v.ean ?? v.gtin);
    expect(primary, 'a primary variant with an EAN is required').toBeTruthy();

    // E3: the provisioned product is multi-variant, so OL must have imported one
    // variant per PrestaShop combination with that combination's own barcode.
    // Asserting the EAN SET (not just the count) catches the failure mode where
    // the adapter falls back to a single synthetic, parent-EAN variant.
    if (freshVariantEans.length > 0) {
      const importedEans = variants.map((v) => v.ean ?? v.gtin).filter((e): e is string => !!e);
      expect(
        importedEans.sort(),
        'OL imported one variant per fresh PrestaShop combination, each with its own EAN',
      ).toEqual([...freshVariantEans].sort());
    }

    state.product = product;
    state.primaryVariant = primary;
    state.variantIds = variants.map((v) => v.id);

    // E3: a brand-new product has NO master inventory row until an inventory sync
    // runs. `master.product.syncAll` imports the catalogue only, and
    // `master.inventory.syncAll` does NOT pick up a just-created product, so a
    // targeted `master.inventory.syncByExternalId` is required before the baseline
    // is meaningful (otherwise S1 sees OL master total 0 vs PS stock N).
    if (env.freshProduct) {
      // `product` came from the list endpoint, which omits externalIds — fetch
      // the detail to resolve the PrestaShop external id for the targeted sync.
      const detail = await api.products.getById(product.id);
      const psExternalId = externalIdFor(detail.externalIds, prestashop!.id);
      if (psExternalId) {
        await jobs.triggerAndWait(
          {
            connectionId: prestashop!.id,
            jobType: 'master.inventory.syncByExternalId',
            payload: { externalId: psExternalId, objectType: 'Product' },
          },
          { timeoutMs: 60_000 },
        );
        await poll.until(
          () => api.inventory.availability(state.variantIds),
          (rows) => rows.some((r) => r.totalAvailable > 0),
          {
            message: 'fresh product master availability after inventory sync',
            timeoutMs: 30_000,
          },
        );
      }

      // Operator's PS→Allegro category-mapping step, scripted: a brand-new
      // product lands in a PS category with no destination mapping, so S3's
      // bulk-offer wizard would flag "needs attention" and fail. Mapping that PS
      // category to an Allegro leaf lets S3 resolve the category and create the
      // offer. Erli borrows Allegro's taxonomy (#1045), so this one mapping
      // covers the Erli offer (S4) too.
      const allegroConn = world.connectionFor(PlatformType.allegro);
      if (allegroConn) {
        // Map the REAL category the product was provisioned into (the
        // `env.freshCategoryPsId` default '2'/Home is only an override fallback
        // for a product provisioned outside this flow).
        const sourceCategoryId = freshCategoryPsId ?? env.freshCategoryPsId;
        await api.mappings.upsertCategoryMapping(allegroConn.id, sourceCategoryId, {
          allegroCategoryId: env.freshAllegroCategoryId,
          allegroCategoryName: 'E2E golden-path category',
        });
      }
    }

    state.olBaseline = await captureStock(api, state.variantIds);

    // Every variant has a REAL master-sourced availability row.
    //
    // `>= 0` on the captured snapshot was unfalsifiable: `getAvailabilityByVariantIds`
    // zero-fills an unknown variant with `{totalAvailable: 0, locationCount: 0}` and
    // `captureStock` pre-seeds its map with 0 on top of that, so the old loop passed
    // with `inventory_items` empty - exactly the state the comment claimed to rule
    // out.
    //
    // `locationCount` is NOT the discriminator it appears to be: the repository
    // derives it as `COUNT(DISTINCT inv.locationId)` (`inventory.repository.ts:109`)
    // and the PrestaShop master writes rows with a NULL `locationId`, so a real
    // freshly-synced row reports `{totalAvailable: 25, locationCount: 0}` - this
    // assertion failed on exactly that, live, on 2026-07-30. Nothing this endpoint
    // returns separates "no row" from "a real row holding zero", so the falsifiable
    // check is a POSITIVE quantity: a variant whose inventory never synced reads 0,
    // and a driver product at zero stock cannot be bought by the segments below.
    const baselineRows = await api.inventory.availability(state.variantIds);
    expect(
      baselineRows.filter((row) => row.totalAvailable > 0).map((row) => row.productVariantId).sort(),
      'every variant carries a real (non-zero-filled) master availability row',
    ).toEqual([...state.variantIds].sort());
  });
});
