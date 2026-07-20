/**
 * Order synthesis (no marketplace purchase)
 *
 * The invoicing suite (#1573) needs orders on demand, unattended — it must
 * never wait on a human buying through a marketplace storefront the way the
 * golden path's `full-flow` PAUSE segment does. PrestaShop is already a
 * supported `OrderSourcePort` (its `date_upd`-watermark ingestion is
 * marketplace-agnostic — see `docs/architecture-overview.md` § Orders), so a
 * REST-order created directly against the PrestaShop webservice is a real
 * order-feed item: `marketplace.orders.poll` on the PrestaShop connection
 * ingests it exactly as it would a storefront checkout.
 *
 * This module creates the minimal customer/address/cart/order graph the
 * webservice requires, using an EXISTING catalogue product/variant (no fresh
 * product provisioning) so it stays fast and side-effect-light. Needs live
 * verification — see the caveats already documented on
 * `PrestashopWebserviceClient.createOrder`.
 *
 * @module support
 */
import type { ApiClient } from '../api/api-client';
import type { SyncJobs } from './jobs';
import type { Poller } from './poller';
import type { World } from '../world/world';
import { PlatformType } from '../world/world';
import type { Product, ProductVariant } from '../api/api.types';
import { PrestashopWebserviceClient } from '../api/prestashop-webservice';
import { snapshotOrderIds, waitForOrder } from './orders';

export interface SynthesizeOrderOptions {
  /** Quantity of the driver variant to sell. Defaults to 1. */
  quantity?: number;
  /** Override unit gross (tax-incl) price; defaults to the variant/product price. */
  unitPriceTaxIncl?: number;
  /**
   * Gross (tax-incl) shipping cost. Defaults to `9.99` (non-zero) so the
   * invoice mapper's shipping line (`toShippingLine`, order-to-issue-invoice
   * mapper) actually renders — a zero-shipping order would silently skip the
   * assertion this suite's scenario 1 needs (#1567).
   */
  shippingTaxIncl?: number;
  /** How long to wait for OL to ingest the synthesized order. Default 60s. */
  timeoutMs?: number;
}

export interface SynthesizedOrder {
  /** The OL order, once ingested and ready. */
  order: Awaited<ReturnType<typeof waitForOrder>>;
  /** The PrestaShop-native order id the webservice created. */
  externalOrderId: string;
  /** The driver product/variant the order was synthesized for. */
  product: Product;
  variant: ProductVariant;
}

/**
 * Resolve the PrestaShop webservice client from env, mirroring the private
 * helper in `tests/golden-path/full-flow.spec.ts` (kept independent per-file —
 * see `docs/engineering-standards.md`, this is test-support code, not a
 * cross-context port).
 */
export function buildPrestashopWebserviceClient(world: World): PrestashopWebserviceClient | null {
  const connection = world.connectionFor(PlatformType.prestashop);
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl =
    process.env.OL_PS_ADMIN_URL?.trim() ||
    (typeof connection?.config?.['baseUrl'] === 'string' ? (connection.config['baseUrl'] as string) : null);
  if (!connection || !key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

/**
 * Pick an existing catalogue product with a priced, EAN-complete driver
 * variant — the invoicing suite reuses whatever the stack already has rather
 * than provisioning a fresh product (unlike the golden path's `E2E_FRESH_PRODUCT`
 * escape hatch).
 */
async function pickDriverProduct(
  api: ApiClient,
): Promise<{ product: Product; variant: ProductVariant } | undefined> {
  const page = await api.products.list({ limit: 50 });
  for (const summary of page.items) {
    const detail = await api.products.getById(summary.id);
    const variants = detail.variants && detail.variants.length > 0 ? detail.variants : (await api.products.listVariants(summary.id)).items;
    const variant = variants.find((v) => (v.ean ?? v.gtin) && v.price !== null && v.price > 0);
    if (variant) {
      return { product: detail, variant };
    }
  }
  return undefined;
}

/**
 * Synthesize a brand-new PrestaShop order via the webservice REST API (no
 * marketplace purchase) and wait for OL to ingest it. Requires
 * `OL_PS_WEBSERVICE_KEY` (+ a resolvable PS base URL) and a PrestaShop
 * connection on the stack — throws with a clear message when either is
 * missing so a spec's `test.skip` reads a precise reason.
 */
export async function synthesizeOrder(
  ctx: { api: ApiClient; world: World; jobs: SyncJobs; poll: Poller },
  options: SynthesizeOrderOptions = {},
): Promise<SynthesizedOrder> {
  const { api, world, jobs } = ctx;
  const prestashop = world.requireConnection(PlatformType.prestashop);
  const ps = buildPrestashopWebserviceClient(world);
  if (!ps) {
    throw new Error(
      'synthesizeOrder requires OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) to create an order via the webservice',
    );
  }

  const driver = await pickDriverProduct(api);
  if (!driver) {
    throw new Error('synthesizeOrder found no catalogue product with a priced, EAN-complete variant');
  }
  const { product, variant } = driver;

  const quantity = options.quantity ?? 1;
  const unitPrice = options.unitPriceTaxIncl ?? variant.price ?? product.price ?? 0;
  if (unitPrice <= 0) {
    throw new Error(`synthesizeOrder: driver variant ${variant.id} has no positive price`);
  }

  const countryId = (await ps.getCountryIdByIso('PL')) ?? '1';
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const customer = await ps.createCustomer({
    firstName: 'E2E',
    lastName: `Invoicing-${suffix}`,
    email: `e2e-invoicing-${suffix}@e2e.openlinker.test`,
    password: 'e2e-Password-123',
  });
  const address = await ps.createAddress({
    idCustomer: customer.id,
    alias: `e2e-${suffix}`,
    firstName: 'E2E',
    lastName: `Invoicing-${suffix}`,
    address1: 'ul. Testowa 1',
    city: 'Warszawa',
    postcode: '00-001',
    idCountry: countryId,
  });

  const externalProductId = externalIdFor(product, prestashop.id);
  if (!externalProductId) {
    throw new Error(`synthesizeOrder: product ${product.id} has no PrestaShop external id mapped`);
  }
  const externalVariantId = externalIdForVariant(variant, prestashop.id);

  const cart = await ps.createCart({
    idCustomer: customer.id,
    idAddressDelivery: address.id,
    idAddressInvoice: address.id,
    rows: [{ productId: externalProductId, productAttributeId: externalVariantId ?? '0', quantity }],
  });

  const shipping = options.shippingTaxIncl ?? 9.99;
  const totalProducts = (unitPrice * quantity).toFixed(6);
  const totalPaid = (unitPrice * quantity + shipping).toFixed(6);
  const created = await ps.createOrder({
    idCustomer: customer.id,
    idAddressDelivery: address.id,
    idAddressInvoice: address.id,
    idCart: cart.id,
    totalProducts,
    totalProductsWt: totalProducts,
    totalPaidTaxExcl: totalPaid,
    totalPaidTaxIncl: totalPaid,
    totalShippingTaxIncl: shipping.toFixed(6),
    rows: [
      {
        productId: externalProductId,
        productAttributeId: externalVariantId ?? '0',
        quantity,
        unitPriceTaxIncl: unitPrice.toFixed(6),
        productReference: variant.sku ?? undefined,
      },
    ],
  });

  const snapshot = await snapshotOrderIds(api, prestashop.id);
  await jobs.trigger({ connectionId: prestashop.id, jobType: 'marketplace.orders.poll' });
  const order = await waitForOrder(api, {
    sourceConnectionId: prestashop.id,
    snapshot,
    timeoutMs: options.timeoutMs ?? 60_000,
    intervalMs: 3_000,
  });

  return { order, externalOrderId: created.id, product, variant };
}

function externalIdFor(product: Product, connectionId: string): string | undefined {
  return product.externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}

function externalIdForVariant(variant: ProductVariant, connectionId: string): string | undefined {
  return variant.externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}
