/**
 * Pricing: PrestaShop master price -> Allegro offer price
 *
 * Follows ONE price end to end and records it at every hop, so a wrong number
 * can be located rather than merely detected:
 *
 *   1. PrestaShop stores the product      - net, as entered (`product.price`)
 *   2. PrestaShop would charge a PL buyer  - gross, computed by PrestaShop itself
 *   3. OpenLinker imports the product      - `Product.price`
 *   4. The bulk wizard submits the offer   - creation-record `request.price`
 *   5. Allegro holds the offer             - live offer price
 *
 * The assertion is the business one: an Allegro buyer must pay what a PL buyer
 * of the same product pays in the shop. Allegro prices are gross, so hop 5 must
 * equal hop 2. The existing golden path does not catch a mismatch here because
 * it chains hop 3 against hop 1 and hop 5 against hop 3 - both equalities hold
 * when the NET figure is carried through unchanged.
 *
 * Every hop is recorded with `expect.soft` and attached as a table, so a red
 * run still prints all five numbers.
 *
 * WARNING: MUTATING. Creates a PrestaShop product and a real Allegro (sandbox)
 * offer. Run only against a stack you control:
 *   pnpm --filter @openlinker/e2e exec playwright test --project=pricing
 *
 * @module tests/pricing
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import type { Product } from '../../src/api/api.types';
import { buildFreshProductImages } from '../../src/api/generate-image';
import {
  FRESH_PRODUCT_CATEGORY_NAME,
  buildPrestashopClient,
  computeEan13,
  externalIdFor,
  readLiveOfferOrNull,
} from '../golden-path/full-flow/helpers';

/** The tax group the product is filed under. Override for a shop that names it differently. */
const TAX_RULES_GROUP_NAME = process.env.E2E_PS_TAX_RULES_GROUP?.trim() || 'PL VAT 23%';

/**
 * A barcode that already has a COMPLETE Allegro catalogue card, so the offer
 * links to it and the row needs no product-section parameters. Unset falls back
 * to a synthetic `590` barcode, which Allegro does not know: the wizard then
 * flags the row and it can only be listed after filling the card by hand.
 */
const CATALOGUE_EAN = process.env.E2E_PRICING_EAN?.trim() || undefined;

/** A round net figure, so the expected gross is readable in a failure message. */
const NET_PRICE = '100.00';

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface PriceHop {
  hop: string;
  amount: number | null;
  basis: string;
}

function formatHops(hops: PriceHop[]): string {
  return hops
    .map((h) => `${h.hop.padEnd(46)} ${h.amount === null ? '(none)'.padStart(10) : h.amount.toFixed(2).padStart(10)}   ${h.basis}`)
    .join('\n');
}

/**
 * The price the Review table shows for the row carrying `reference`. The row is
 * the deepest element holding both the SKU and a `PLN` amount.
 */
async function readReviewPrice(page: Page, reference: string): Promise<number | null> {
  const row = page.locator(`*:has-text("${reference}")`).filter({ hasText: /\d+\.\d{2}\s*PLN/ }).last();
  const text = await row.innerText({ timeout: 5_000 }).catch(() => null);
  const match = text?.match(/(\d+(?:[.,]\d{2}))\s*PLN/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

test.describe.configure({ mode: 'serial' });

test('the Allegro offer carries the gross price a PL shop buyer pays', async ({
  api,
  world,
  jobs,
  poll,
  pages,
  page,
  env,
}) => {
  test.setTimeout(15 * 60_000);

  const prestashop = world.connectionFor(PlatformType.prestashop);
  test.skip(!prestashop, 'no PrestaShop connection on this stack');
  const allegro = world.connectionWithCapability('OfferManager', PlatformType.allegro);
  test.skip(!allegro, 'no Allegro connection with OfferManager on this stack');
  const ps = buildPrestashopClient(world);
  test.skip(!ps, 'OL_PS_WEBSERVICE_KEY / PrestaShop base URL not configured');

  const hops: PriceHop[] = [];
  const record = (hop: string, amount: number | null, basis: string): void => {
    hops.push({ hop, amount, basis });
  };

  const suffix = Date.now().toString();
  const reference = `E2E-PRICE-${suffix}`;

  // ── 1. Create the product in PrestaShop ────────────────────────────────
  const created = await test.step('PrestaShop: create a product priced 100.00 net under PL VAT', async () => {
    const taxGroupId = await ps!.getTaxRulesGroupIdByName(TAX_RULES_GROUP_NAME);
    test.skip(!taxGroupId, `PrestaShop has no tax-rules group named "${TAX_RULES_GROUP_NAME}"`);
    const categoryId =
      (await ps!.getCategoryIdByName(FRESH_PRODUCT_CATEGORY_NAME)) ??
      (await ps!.createCategory({ name: FRESH_PRODUCT_CATEGORY_NAME })).id;

    const product = await ps!.createProduct({
      name: `E2E Pricing ${suffix}`,
      reference,
      // GS1 `590` (Poland), slot 77 so it never collides with the golden path's
      // `00..nn` variant / `99` parent slots for the same timestamp.
      ean13: CATALOGUE_EAN ?? computeEan13(`590${suffix.slice(-7)}77`),
      price: NET_PRICE,
      quantity: 10,
      idCategoryDefault: categoryId,
      idTaxRulesGroup: taxGroupId!,
    });
    for (const image of buildFreshProductImages()) {
      await ps!.addProductImage(product.id, image);
    }
    return { productId: product.id, categoryId };
  });

  // ── 2. What PrestaShop says the price is ───────────────────────────────
  const psPrices = await test.step('PrestaShop: read the net and the PL gross price it computes', async () => {
    const plCountryId = await ps!.getCountryIdByIso('PL');
    expect(plCountryId, 'PrestaShop knows Poland').toBeTruthy();
    const prices = await ps!.getProductPrices(created.productId, plCountryId!);
    record('1. PrestaShop product.price (as stored)', prices.net, 'net');
    record('2. PrestaShop price for a PL buyer', prices.gross, 'gross (PrestaShop-computed)');
    // Without this the test would pass on a shop that charges no tax at all,
    // which proves nothing about net vs gross.
    expect(prices.gross, 'the tax group really adds VAT for PL - otherwise net == gross and the test is vacuous').toBeGreaterThan(prices.net);
    return prices;
  });

  // ── 2b. What the storefront shows (informational) ──────────────────────
  await test.step('PrestaShop storefront: what a visitor sees (screenshot)', async () => {
    const storefront = env.psAdminUrl;
    if (!storefront) return;
    try {
      await page.goto(`${storefront}/index.php?id_product=${created.productId}&controller=product`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      const shown = await page
        .locator('[itemprop="price"], .current-price-value, .current-price')
        .first()
        .textContent({ timeout: 10_000 })
        .catch(() => null);
      test.info().annotations.push({
        type: 'storefront-price',
        description: `storefront shows "${shown?.trim() ?? '(not found)'}" - this follows PS_COUNTRY_DEFAULT, so a shop whose default country is not PL may show the NET figure`,
      });
      await test.info().attach('prestashop-storefront', {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      });
    } catch (error) {
      test.info().annotations.push({ type: 'storefront-price', description: `storefront unreachable: ${String(error)}` });
    }
  });

  // ── 3. Import into OpenLinker ──────────────────────────────────────────
  const olProduct = await test.step('OpenLinker: import the product from PrestaShop', async () => {
    await jobs.triggerAndWait(
      {
        connectionId: prestashop!.id,
        jobType: 'master.product.syncByExternalId',
        payload: { externalId: created.productId, objectType: 'Product' },
      },
      { timeoutMs: 120_000 },
    );
    const product = (await poll.until<Product | undefined>(
      async () => (await api.products.list({ search: reference, limit: 5 })).items.find((p) => p.sku === reference),
      (p) => !!p,
      { message: `OL product with SKU ${reference}`, timeoutMs: 60_000 },
    ))!;
    record('3. OpenLinker Product.price', product.price, 'whatever the master sent');

    // The wizard reads master stock; a fresh product has none until this runs.
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
    }
    return detail;
  });

  const variants = await world.variantsOf(olProduct.id);
  const primary = variants.find((v) => v.ean ?? v.gtin);
  expect(primary, 'the imported product has a barcoded variant').toBeTruthy();

  // ── 4. Publish to Allegro through the wizard ───────────────────────────
  const batchId = await test.step('OpenLinker: publish to Allegro with the default "Use master price"', async () => {
    // Operator's PS -> Allegro category mapping, scripted (same as golden-path S0).
    await api.mappings.upsertCategoryMapping(allegro!.id, created.categoryId, {
      allegroCategoryId: env.freshAllegroCategoryId,
      allegroCategoryName: 'E2E pricing category',
    });

    await pages.productsList.goto();
    await pages.productsList.selectProduct(reference);
    const wizard = await pages.productsList.startBulkOfferCreation(allegro!.name);
    await wizard.selectConnectionIfPresent(allegro!.name);
    // Pricing is left on the wizard's default policy on purpose: that is what
    // an operator gets without touching anything.
    // The Review step prints the price it is about to send. It is read even when
    // the wizard then refuses to submit, because that number alone already
    // answers the net-vs-gross question for this hop.
    let wizardError: unknown;
    await wizard
      .advanceToConfirmModal({
        requiresDeliveryPolicy: true,
        gtin: primary!.ean ?? primary!.gtin ?? undefined,
      })
      .catch((error: unknown) => {
        wizardError = error;
      });
    record('3b. Price shown on the wizard Review step', await readReviewPrice(page, reference), 'what the operator is shown');
    await test.info().attach('wizard-review', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    if (wizardError) {
      await test.info().attach('price-hops-so-far.txt', { body: formatHops(hops), contentType: 'text/plain' });
      throw wizardError;
    }
    const progress = await wizard.confirmCreation();
    expect(progress.batchId).toBeTruthy();
    return progress.batchId;
  });

  // ── 5. What was sent, and what Allegro holds ───────────────────────────
  await test.step('Allegro: read the submitted and the live offer price', async () => {
    const batch = await poll.until(
      () => api.listings.getBulkBatch(batchId),
      (b) => b.records.some((r) => r.internalVariantId === primary!.id && r.status !== 'pending'),
      { message: `creation record for ${primary!.id} to leave the queue`, timeoutMs: 180_000 },
    );
    const rec = batch.records.find((r) => r.internalVariantId === primary!.id)!;
    const creation = await api.listings.getOfferCreationRecord(allegro!.id, rec.id);
    record('4. Price OpenLinker submitted to Allegro', creation.request?.price?.amount ?? null, 'sent as-is; Allegro reads it as gross');

    if (rec.status === 'failed') {
      test.info().annotations.push({
        type: 'allegro-rejected',
        description: (rec.errors ?? []).map((e) => `${e.code ?? ''} ${e.message ?? ''}`).join(' | '),
      });
    }

    const mapping = await poll
      .until(
        () => api.listings.list({ connectionId: allegro!.id, internalId: primary!.id, limit: 5 }),
        (p) => p.items.some((m) => m.internalId === primary!.id),
        { message: 'offer mapping for the primary variant', timeoutMs: 120_000 },
      )
      .then((p) => p.items.find((m) => m.internalId === primary!.id))
      .catch(() => undefined);
    const live = mapping ? await readLiveOfferOrNull(api, mapping.id) : null;
    record('5. Allegro live offer price', live ? Number(live.price.amount) : null, 'gross (Allegro prices are buyer-facing)');
    if (live?.marketplaceUrl) {
      test.info().annotations.push({ type: 'allegro-offer', description: live.marketplaceUrl });
    }
  });

  // ── Verdict ────────────────────────────────────────────────────────────
  const table = formatHops(hops);
  await test.info().attach('price-hops.txt', { body: table, contentType: 'text/plain' });
  console.log(`\nPrice hops for ${reference}:\n${table}\n`);

  const expectedGross = round2(psPrices.gross);
  const submitted = hops.find((h) => h.hop.startsWith('4.'))?.amount ?? null;
  const live = hops.find((h) => h.hop.startsWith('5.'))?.amount ?? null;

  expect.soft(submitted, `price submitted to Allegro should be the PL gross ${expectedGross}, not the net ${round2(psPrices.net)}`).toBe(expectedGross);
  if (live !== null) {
    expect.soft(live, `Allegro offer price should be the PL gross ${expectedGross}`).toBe(expectedGross);
  }
});
