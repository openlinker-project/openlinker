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
import { waitForOrderByExternalId } from './orders';

export interface SynthesizeOrderOptions {
  /** Quantity of the driver variant to sell. Defaults to 1. */
  quantity?: number;
  /**
   * PrestaShop currency id to denominate the order in. Defaults to the
   * webservice client's own default, which is the shop's first currency.
   *
   * Threaded onto BOTH the cart and the order: PrestaShop stores
   * `id_currency` on each, and an order whose cart disagrees is a shape no
   * storefront checkout produces. Resolve the id with
   * `PrestashopWebserviceClient.getCurrencyIdByIso` rather than hardcoding
   * one - ids are per-install.
   */
  currencyId?: string;
  /** Override unit gross (tax-incl) price; defaults to the variant/product price. */
  unitPriceTaxIncl?: number;
  /**
   * Requested gross (tax-incl) shipping cost, defaulting to `9.99`.
   *
   * NOT honoured by PrestaShop. Verified live against the demo install: the
   * raw webservice `POST /api/orders` unconditionally resets `id_carrier` to
   * `1` and `total_shipping*` to `0`, whatever the request sends and whatever
   * the referenced cart carries (tried with the cart's `id_carrier` AND a
   * fully-serialized `delivery_option` pointing at each chargeable carrier).
   * That is the documented #503/#898 behaviour — the raw webservice bypasses
   * `validateOrder`, which is exactly why OL's own order-create path goes
   * through the OL module's `importorder` endpoint instead (ADR-016).
   *
   * The field stays on the wire because it expresses the intended order, but
   * a synthesized order always ingests with `totals.shipping = 0`. Assertions
   * on a shipping line must therefore be conditional on the INGESTED value —
   * see the `infakt-provider` spec.
   */
  shippingTaxIncl?: number;
  /**
   * How long to wait for OL to ingest the synthesized order. Default 180s.
   *
   * The wait covers queue latency, not just execution: synthesis enqueues a
   * `marketplace.orders.poll` job that runs behind whatever the stack's
   * schedulers already queued (30+ jobs is normal on the shared demo stack),
   * so a 60 s budget failed intermittently while the job was merely waiting
   * its turn.
   */
  timeoutMs?: number;
}

export interface SynthesizedOrder {
  /** The OL order, once ingested and ready. */
  order: Awaited<ReturnType<typeof waitForOrderByExternalId>>;
  /** The PrestaShop-native order id the webservice created. */
  externalOrderId: string;
  /** The driver product/variant the order was synthesized for. */
  product: Product;
  variant: ProductVariant;
}

/**
 * Resolve the PrestaShop webservice client from env, mirroring the private
 * helper in `tests/golden-path/full-flow/helpers.ts` (kept independent per-file —
 * see `docs/engineering-standards.md`, this is test-support code, not a
 * cross-context port).
 */
export function buildPrestashopWebserviceClient(world: World): PrestashopWebserviceClient | null {
  const connection = world.connectionFor(PlatformType.prestashop);
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl =
    process.env.OL_PS_ADMIN_URL?.trim() ||
    (typeof connection?.config?.['baseUrl'] === 'string' ? (connection.config['baseUrl']) : null);
  if (!connection || !key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

/**
 * Pick an existing catalogue product with a priced, EAN-complete driver
 * variant — the invoicing suite reuses whatever the stack already has rather
 * than provisioning a fresh product (unlike the golden path's `E2E_FRESH_PRODUCT`
 * escape hatch).
 *
 * MUST be scoped to `connectionId`: a stack that has been re-pointed at a
 * fresh PrestaShop connection (a new `Connection` row minted on this boot)
 * can still carry `Product` rows whose ONLY external-id mapping is against a
 * now-disabled connection from an earlier run — OL's product catalogue is
 * global, not per-connection, and old rows are never pruned. Picking by
 * "has an EAN and a price" alone can therefore return a product this
 * connection has no mapping for at all, which `synthesizeOrder` then fails
 * on immediately after ("… has no PrestaShop external id mapped") — caught
 * live on 2026-09-04 against a stack carrying two prior PrestaShop
 * connections' worth of residue.
 */
async function pickDriverProduct(
  api: ApiClient,
  connectionId: string,
): Promise<{ product: Product; variant: ProductVariant } | undefined> {
  const page = await api.products.list({ limit: 50 });
  for (const summary of page.items) {
    const detail = await api.products.getById(summary.id);
    if (!externalIdFor(detail, connectionId)) continue;
    const variants = detail.variants && detail.variants.length > 0 ? detail.variants : (await api.products.listVariants(summary.id)).items;
    // Variant-level external id is OPTIONAL downstream (`synthesizeOrder`
    // falls back to `productAttributeId: '0'` for a simple product's
    // synthetic variant, which legitimately carries no mapping of its own) —
    // only the PRODUCT-level mapping is required here.
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

  const driver = await pickDriverProduct(api, prestashop.id);
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
  // PrestaShop's `isName` validator (customer/address first+last name) rejects
  // digits and most punctuation, so the unique `suffix` can't live in the
  // name — it stays in the email and the address alias (validated by the more
  // permissive `isGenericName`). Names are fixed, purely-alphabetic values.
  const customerName = { firstName: 'Erik', lastName: 'Testowy' };
  const customer = await ps.createCustomer({
    ...customerName,
    email: `e2e-invoicing-${suffix}@e2e.openlinker.test`,
    password: 'e2e-Password-123',
  });
  const address = await ps.createAddress({
    idCustomer: customer.id,
    alias: `e2e-${suffix}`,
    ...customerName,
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
    idCurrency: options.currencyId,
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
    currencyId: options.currencyId,
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

  // Match the ingested order by the PrestaShop id we just created, not by
  // "an order id absent from a snapshot". The snapshot could only be taken
  // AFTER the create returned, and PrestaShop's webhook often ingests the
  // order before that call lands — the order then sits INSIDE the snapshot and
  // the wait can never be satisfied. Identity beats novelty, and it also
  // removes any confusion with orders other activity produces concurrently.
  const order = await waitForOrderByExternalId(api, {
    sourceConnectionId: prestashop.id,
    externalOrderId: created.id,
    timeoutMs: options.timeoutMs ?? 180_000,
    intervalMs: 3_000,
    // The webhook is the fast path; re-triggering a direct per-order sync is
    // the backstop for a dropped delivery. See `retriggerDirectOrderSync`.
    retriggerPoll: jobs.retriggerDirectOrderSync(prestashop.id, created.id),
  });

  return { order, externalOrderId: created.id, product, variant };
}

function externalIdFor(product: Product, connectionId: string): string | undefined {
  return product.externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}

function externalIdForVariant(variant: ProductVariant, connectionId: string): string | undefined {
  return variant.externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}
