/**
 * The one product this suite can sell through a shop AND document in Subiekt.
 *
 * ## The constraint that forces this to exist
 *
 * `SubiektOrderProcessorManagerAdapter` refuses a line whose product carries no
 * mapping on ITS connection - "the product must be synced from this Subiekt
 * connection (ProductMaster) before an order referencing it can be created
 * here" - so an order OpenLinker is to mirror into Subiekt must be for a
 * product Subiekt already knows.
 *
 * `pickDriverProduct` in `order-synthesis.ts` requires only a PrestaShop
 * mapping, which on a real stack is a shop-native product Subiekt has never
 * seen. An order for it reaches OpenLinker, fans out, and is refused at the
 * Subiekt destination with exactly that message - which is how
 * `order-to-documents.spec.ts` came to fail against a perfectly healthy bridge.
 *
 * ## Why the shop id cannot be looked up the ordinary way
 *
 * Publishing writes a `ShopProduct` mapping, and `GET /products/:id` returns
 * `Product` mappings only, so the published id is invisible to OpenLinker's own
 * products API. It is read back from the shop instead, keyed on the INTERNAL
 * VARIANT ID: `PrestashopProductPublisherAdapter` sets `body.reference =
 * cmd.internalVariantId` deliberately, as the stable server-side key its
 * create-idempotency guard adopts an orphan by (#1107). A lookup by SKU finds
 * nothing.
 *
 * ## Idempotent, because two specs need the same product
 *
 * A variant already reporting a listing is not published again. Two specs in
 * one serial project would otherwise publish the same towar twice and leave a
 * second shop product behind on every run.
 *
 * @module src/support
 */
import { expect } from '@playwright/test';
import type { ApiClient } from '../api/api-client';
import type { Connection, Product, ProductVariant } from '../api/api.types';
import type { PrestashopWebserviceClient } from '../api/prestashop-webservice';

/** A publish is a job; the mapping it writes appears only once that job ran. */
const PUBLISH_TIMEOUT_MS = 180_000;

export interface SubiektShopDriver {
  readonly product: Product;
  readonly variant: ProductVariant;
  /** The towar symbol, i.e. the product's external id on the Subiekt connection. */
  readonly symbol: string;
  /** The id the SHOP reports for the product OpenLinker published. */
  readonly shopProductId: string;
  /** The connection that published it - and the one that resolves the order line. */
  readonly publishConnection: Connection;
}

/** The external id this product carries on `connectionId`, or null. */
export function externalIdOn(product: Product, connectionId: string): string | null {
  return product.externalIds?.find((m) => m.connectionId === connectionId)?.externalId ?? null;
}

/**
 * The first catalogue product carrying a Subiekt mapping and a sellable
 * variant, or null.
 *
 * Scoped to the Subiekt connection because OpenLinker's catalogue is global and
 * carries other masters' products, so an unscoped page decides the outcome by
 * whatever sorts first.
 */
export async function pickSubiektProduct(
  api: ApiClient,
  subiektConnectionId: string,
): Promise<{ product: Product; variant: ProductVariant; symbol: string } | null> {
  const page = await api.products.list({ limit: 50, connectionId: subiektConnectionId });
  for (const summary of page.items) {
    const detail = await api.products.getById(summary.id);
    const symbol = externalIdOn(detail, subiektConnectionId);
    if (!symbol) continue;
    const variants =
      detail.variants && detail.variants.length > 0
        ? detail.variants
        : (await api.products.listVariants(summary.id)).items;
    const variant = variants.find(
      (v) => (v.price ?? detail.price ?? 0) > 0 && !!(v.sku ?? detail.sku),
    );
    if (variant) return { product: detail, variant, symbol };
  }
  return null;
}

/** Poll until the variant reports a listing on `connectionId`. */
async function waitForPublishedMapping(
  api: ApiClient,
  connectionId: string,
  variantId: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const published = await api.listings.publishedVariants(connectionId, [variantId]);
    if (published.includes(variantId)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

/**
 * Publish a Subiekt towar to `publishConnection` if it is not already there,
 * and report the id the shop gave it.
 *
 * Returns `null` when the Subiekt catalogue holds nothing sellable, so a caller
 * can skip for the honest reason instead of failing on a stack that has never
 * synced.
 */
export async function ensureSubiektProductOnShop(
  api: ApiClient,
  ps: PrestashopWebserviceClient,
  subiektConnectionId: string,
  publishConnection: Connection,
): Promise<SubiektShopDriver | null> {
  const picked = await pickSubiektProduct(api, subiektConnectionId);
  if (picked === null) return null;

  const alreadyPublished = await api.listings.publishedVariants(publishConnection.id, [
    picked.variant.id,
  ]);
  if (!alreadyPublished.includes(picked.variant.id)) {
    await api.listings.shopPublish(publishConnection.id, {
      internalVariantId: picked.variant.id,
      status: 'published',
      // Enough to sell, and no claim about stock this helper did not check.
      stock: 10,
      ...(picked.variant.price !== null && picked.variant.price !== undefined
        ? {
            price: {
              amount: picked.variant.price,
              currency: picked.product.currency ?? 'PLN',
            },
          }
        : {}),
    });
    const mapped = await waitForPublishedMapping(
      api,
      publishConnection.id,
      picked.variant.id,
      PUBLISH_TIMEOUT_MS,
    );
    expect(
      mapped,
      `variant ${picked.variant.id} never reported a listing on ${publishConnection.name} - the ` +
        `publish job did not write its ShopProduct mapping (check ProductPublisher is enabled ` +
        `on that connection)`,
    ).toBe(true);
  }

  const shopProductId = await ps.getProductIdByReference(picked.variant.id);
  expect(
    shopProductId,
    `no shop product carries reference "${picked.variant.id}" - the publish reported a mapping ` +
      `but the product is not findable by the reference it was published under`,
  ).not.toBeNull();

  return { ...picked, shopProductId: shopProductId!, publishConnection };
}
