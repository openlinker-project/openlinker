/**
 * G11 IMG - variant pictures (#3586, #3587; M26 `variant-images`, `viewer`)
 *
 * Variant-level pictures from the PrestaShop and WooCommerce adapters, the
 * fallback to the product's own, the image proxy (and its SSRF refusal) and the
 * role question. The catalogue is whatever the setup file names; the scenarios
 * read it back through the UI, the API and SQL rather than assuming a fixture.
 *
 * @module tests/oms-mvp/g11
 */
import type { Locator } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/g11';
import { VariantCostPage } from '../../../src/pages/variant-cost.page';
import { lit } from '../../../src/support/g11/db';

interface VariantBody {
  id: string;
  images: string[] | null;
  imageUrls: string[];
  imagesFromProduct: boolean;
}

async function allImagesLoaded(strip: Locator): Promise<boolean> {
  return strip.locator('img').evaluateAll((imgs) =>
    imgs.length > 0 && imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
  );
}

test.describe('G11 IMG - variant pictures @g11', () => {
  test('IMG-1 PrestaShop variants each show their OWN picture', async ({ openAs, ctx, http }) => {
    const psA = ctx.setup.products.psA;
    test.skip(!psA?.variants.A1 || !psA.variants.A2, 'setup.products.psA (A1, A2) missing');
    const [a1, a2] = [psA!.variants.A1, psA!.variants.A2];

    const rows = ctx.db.rows<{ sku: string; images: string[] | null }>(
      `SELECT sku, images FROM product_variants WHERE id IN (${lit(a1.variantId)}, ${lit(a2.variantId)})`,
    );
    for (const row of rows) {
      expect(row.images?.length ?? 0, `${row.sku} stores its own pictures`).toBeGreaterThan(0);
    }
    expect(new Set(rows.map((r) => JSON.stringify(r.images))).size, 'the two combinations differ').toBe(2);

    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(psA!.productId);
    const srcs: string[] = [];
    for (const v of [a1, a2]) {
      await cost.open(v.sku);
      await expect(cost.photoStrip(v.sku)).toBeVisible();
      await expect.poll(() => allImagesLoaded(cost.photoStrip(v.sku))).toBe(true);
      srcs.push((await cost.photoStrip(v.sku).locator('img').first().getAttribute('src')) ?? '');
    }
    expect(srcs[0]).not.toBe(srcs[1]);
    await expect(page.getByText('From product')).toHaveCount(0);

    const variants = (await http.admin.get(`/products/${psA!.productId}/variants`)).json<{ items: VariantBody[] }>();
    for (const v of variants.items.filter((i) => [a1.variantId, a2.variantId].includes(i.id))) {
      expect(v.imagesFromProduct).toBe(false);
    }
    const shot = test.info().outputPath('img-1.png');
    await page.screenshot({ path: shot, fullPage: true });
    await test.info().attach('IMG-1', { path: shot, contentType: 'image/png' });
  });

  test('IMG-2 WooCommerce: own picture, and the product picture labelled "From product"', async ({ openAs, ctx }) => {
    const woo = ctx.setup.products.wooVariable;
    const withImage = woo?.variants.withImage;
    const withoutImage = woo?.variants.withoutImage;
    test.skip(!withImage || !withoutImage, 'setup.products.wooVariable (withImage, withoutImage) missing');
    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(woo!.productId);

    await cost.open(withImage!.sku);
    await expect.poll(() => allImagesLoaded(cost.photoStrip(withImage!.sku))).toBe(true);
    await cost.open(withoutImage!.sku);
    await expect(cost.photoSource.filter({ hasText: /no photos of its own/i }).first()).toBeVisible();
    await expect.poll(() => allImagesLoaded(cost.photoStrip(withoutImage!.sku))).toBe(true);

    const broken = await page.locator('img').evaluateAll((imgs) =>
      imgs.filter((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 0).length,
    );
    expect(broken, 'no broken <img> on the variants table').toBe(0);
  });

  test('IMG-3 a variant without its own picture resolves to the product picture', async ({ openAs, ctx, http }) => {
    const psB = ctx.setup.products.psB;
    const b1 = psB?.variants.B1;
    test.skip(!b1, 'setup.products.psB.B1 missing');
    const response = await http.admin.get(`/products/${psB!.productId}/variants`);
    expect(response.status).toBe(200);
    const variant = response.json<{ items: VariantBody[] }>().items.find((v) => v.id === b1!.variantId);
    expect(variant, 'B1 in the variants list').toBeDefined();
    expect(variant!.images ?? []).toEqual([]);
    expect(variant!.imagesFromProduct).toBe(true);
    expect(variant!.imageUrls.length).toBeGreaterThan(0);

    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(psB!.productId);
    await expect(cost.photoSource.first()).toContainText(/product photos are used/i);
  });

  test('IMG-4 the variant image proxy streams bytes and 404s out of range', async ({ ctx, http }) => {
    const a1 = ctx.setup.products.psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');
    const ok = await http.admin.get(`/products/variants/${a1!.variantId}/images/0`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type') ?? '').toMatch(/^image\//);
    expect(ok.buffer.length).toBeGreaterThan(100);
    expect(ok.headers.get('location')).toBeNull();

    expect((await http.admin.get(`/products/variants/${a1!.variantId}/images/999`)).status).toBe(404);
    expect((await http.admin.get('/products/variants/ol_variant_doesnotexist/images/0')).status).toBe(404);
  });

  test('IMG-5 SSRF: a link-local picture url is refused, an internal shop host stays reachable', async ({ ctx, http, db }) => {
    const a2 = ctx.setup.products.psA?.variants.A2;
    test.skip(!a2, 'setup.products.psA.A2 missing');
    const original = db.scalar(`SELECT coalesce(images::text, 'null') FROM product_variants WHERE id = ${lit(a2!.variantId)}`);
    expect(original).not.toBeNull();
    try {
      db.exec(
        `UPDATE product_variants SET images = '["http://169.254.169.254/latest/meta-data/"]'::jsonb WHERE id = ${lit(a2!.variantId)}`,
      );
      const refused = await http.admin.get(`/products/variants/${a2!.variantId}/images/0`);
      expect([400, 403, 404], 'metadata host is refused, never fetched').toContain(refused.status);
      expect(refused.headers.get('content-type') ?? '').not.toMatch(/^image\//);
    } finally {
      db.exec(`UPDATE product_variants SET images = ${lit(original!)}::jsonb WHERE id = ${lit(a2!.variantId)}`);
    }
    const restored = await http.admin.get(`/products/variants/${a2!.variantId}/images/0`);
    expect(restored.status, 'the original (internal-host) picture is reachable again').toBe(200);
  });

  test('IMG-6 pack bench line shows the variant picture', () => {
    test.fixme(
      true,
      'needs a routed order with an accepted FulfillmentWork containing the seeded variants (OMS routing chain, ADR-054); ' +
        'the bench seed uses its own product. Verify by hand until the stack agent provides a routed work (mockup: variant-photo-bench-preview).',
    );
  });

  test('IMG-7 listing picker / offer wizard show the variant picture', () => {
    test.fixme(
      true,
      'needs an OfferManager destination connection on the stand and verified picker selectors; not part of the setup file contract.',
    );
  });

  test('IMG-8 re-sync picks up a changed combination picture, product picture untouched', () => {
    test.fixme(
      true,
      'needs a PrestaShop webservice image upload on a combination (addProductImage supports products only) and a forced master.product.syncByExternalId; ' +
        'not implemented without a combination-image helper.',
    );
  });

  test('IMG-9 viewer sees the pictures and no cost controls', async ({ openAs, ctx }) => {
    const a1 = ctx.setup.products.psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');
    const page = await openAs('viewer');
    const cost = new VariantCostPage(page);
    await cost.goto(ctx.setup.products.psA!.productId);
    await cost.open(a1!.sku);
    await expect.poll(() => allImagesLoaded(cost.photoStrip(a1!.sku))).toBe(true);
    await expect(cost.addButton(a1!.sku)).toHaveCount(0);
    await expect(cost.clearButton(a1!.sku)).toHaveCount(0);
  });

  test('IMG-10 packer reads pictures, and the variant reads carry no cost fields', async ({ ctx, http }) => {
    const psA = ctx.setup.products.psA;
    const a1 = psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');
    const image = await http.packer.get(`/products/variants/${a1!.variantId}/images/0`);
    expect(image.status).toBe(200);
    for (const path of [`/products/${psA!.productId}/variants`, `/products/variants/${a1!.variantId}`, `/products/${psA!.productId}`]) {
      const response = await http.packer.get(path);
      expect(response.status, path).toBe(200);
      expect(response.text, `${path} must not carry cost`).not.toMatch(/netUnitCost|costCurrency|unitCostNet|costUpdatedAt/);
    }
  });
});
