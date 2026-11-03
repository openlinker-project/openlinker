/**
 * Shared steps for the ksef-legal suite (#1578).
 *
 * Kept to what more than one spec needs: resolving the stack's KSeF and
 * PrestaShop connections with a precise skip reason, issuing an invoice and
 * waiting for KSeF TEST to clear it, and reading an `ApiError`'s body.
 *
 * @module tests/ksef-legal
 */
import { test } from '../../src/fixtures/test';
import { ApiError } from '../../src/api/api-error';
import type { ApiClient } from '../../src/api/api-client';
import type { Connection, InvoiceRecord, IssueInvoiceInput } from '../../src/api/api.types';
import type { SyncJobs } from '../../src/support/jobs';
import type { Poller } from '../../src/support/poller';
import { PlatformType, type World } from '../../src/world/world';
import {
  buildPrestashopWebserviceClient,
  resolvePrestashopStore,
  synthesizeOrder,
  type SynthesizeOrderOptions,
  type SynthesizedOrder,
} from '../../src/support/order-synthesis';
import type { Product, ProductVariant } from '../../src/api/api.types';
import type { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';

/** A checksum-valid synthetic Polish NIP (see tests/invoicing/corrections.spec.ts). */
export const BUYER_NIP = '1234563218';

/** The same NIP as an operator might paste it, with separators (DEF-11). */
export const BUYER_NIP_DASHED = '123-456-32-18';

/** Resolve the KSeF connection, or skip the test with the reason. */
export function requireKsef(world: World): Connection {
  const ksef = world.connectionFor(PlatformType.ksef);
  test.skip(!ksef, 'no active KSeF connection on this stack');
  test.skip(
    !buildPrestashopWebserviceClient(world),
    'OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) is required to synthesize an order'
  );
  return ksef!;
}

/** Poll until the invoice is accepted by KSeF TEST, nudging the reconcile job. */
export async function waitForAccepted(
  ctx: { api: ApiClient; jobs: SyncJobs; poll: Poller },
  ksef: Connection,
  orderId: string
): Promise<InvoiceRecord> {
  return ctx.poll.until(
    async () => {
      await ctx.jobs
        .trigger({
          connectionId: ksef.id,
          jobType: 'invoicing.regulatoryStatus.reconcile',
          payload: { schemaVersion: 1 },
        })
        .catch(() => undefined);
      return ctx.api.invoices.getForOrder(orderId, ksef.id);
    },
    (r) => r.regulatoryStatus === 'accepted' || r.regulatoryStatus === 'rejected',
    {
      message: 'KSeF invoice to reach a terminal clearance status',
      timeoutMs: 300_000,
      intervalMs: 10_000,
    }
  );
}

/** Poll ONE record by id until its clearance is terminal (a correction, say). */
export async function waitForRecordCleared(
  ctx: { api: ApiClient; jobs: SyncJobs; poll: Poller },
  ksef: Connection,
  invoiceId: string
): Promise<InvoiceRecord> {
  return ctx.poll.until(
    async () => {
      await ctx.jobs
        .trigger({
          connectionId: ksef.id,
          jobType: 'invoicing.regulatoryStatus.reconcile',
          payload: { schemaVersion: 1 },
        })
        .catch(() => undefined);
      return ctx.api.invoices.getById(invoiceId);
    },
    (r) =>
      r.regulatoryStatus === 'accepted' ||
      r.regulatoryStatus === 'rejected' ||
      r.status === 'failed',
    {
      message: `invoice ${invoiceId} to reach a terminal clearance status`,
      timeoutMs: 300_000,
      intervalMs: 10_000,
    }
  );
}

/** Issue on KSeF and wait for clearance. */
export async function issueAndClear(
  ctx: { api: ApiClient; jobs: SyncJobs; poll: Poller },
  ksef: Connection,
  orderId: string,
  extra: Partial<IssueInvoiceInput> = {}
): Promise<InvoiceRecord> {
  await ctx.api.invoices.issue({ connectionId: ksef.id, orderId, ...extra });
  return waitForAccepted(ctx, ksef, orderId);
}

/** The HTTP status + JSON body of a failed call, or null when it succeeded. */
export async function failureOf(
  call: Promise<unknown>
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    await call;
    return null;
  } catch (error) {
    if (error instanceof ApiError) {
      const body = (
        typeof error.body === 'object' && error.body !== null ? error.body : {}
      ) as Record<string, unknown>;
      return { status: error.status, body };
    }
    throw error;
  }
}

/** Namespace-prefix tolerant: the text of every `<localName>` element. */
export function elementTexts(xml: string, localName: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${localName}>([\\s\\S]*?)</(?:\\w+:)?${localName}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

export function hasElement(xml: string, localName: string): boolean {
  return new RegExp(`<(?:\\w+:)?${localName}[\\s>]`).test(xml);
}

/**
 * A catalogue product the shop taxes at 23%, .
 *
 * The PrestaShop cart prices each row from the product's OWN tax rule, so a
 * product with no rule makes the order line 0% - which OpenLinker then reads,
 * correctly, as a plain "0" that FA(3) cannot carry (it needs 0 KR / 0 WDT /
 * 0 EX) and refuses before KSeF. A positional pick lands on such a product on
 * this catalogue, so the suite asks for a taxed one by name.
 */
async function pickTaxedDriver(
  api: ApiClient,
  ps: PrestashopWebserviceClient,
  connectionId: string,
  countryId: string,
  homeCountryId: string,
  wantRate: '23' | null
): Promise<{ product: Product; variant: ProductVariant; gross: number } | undefined> {
  for (let offset = 0; offset < 1000; offset += 50) {
    const page = await api.products.list({ limit: 50, offset, connectionId });
    for (const summary of page.items) {
      if ((summary.taxRate ?? null) !== wantRate) continue;
      const product = await api.products.getById(summary.id);
      const externalId = product.externalIds?.find(
        (e) => e.connectionId === connectionId
      )?.externalId;
      if (!externalId) continue;
      const variants =
        product.variants && product.variants.length > 0
          ? product.variants
          : (await api.products.listVariants(summary.id)).items;
      // The price comes from the SHOP below; OpenLinker's own catalogue price
      // may be absent on a clone, and is not what the buyer pays anyway.
      // Simple products only: for a product with combinations the cart and the
      // price read can disagree on which combination they price, and a posted
      // total the shop disagrees with lands the order in "Payment error".
      if (variants.length !== 1) continue;
      const variant = variants[0];
      if (variant.externalIds?.some((e) => e.connectionId === connectionId)) continue;
      const combinationId = '0';
      // OpenLinker's catalogue can outlive the shop's: skip a product the shop
      // no longer has, and pay what the shop itself charges for it.
      // Taxed is judged in the shop's home country; a foreign buyer may well be
      // charged no Polish VAT, which is the cross-border case itself.
      const home = await ps
        .getProductPrices(externalId, homeCountryId, combinationId)
        .catch(() => null);
      if (!home || (wantRate !== null && !(home.gross > home.net))) continue;
      // The computed price must agree with the product's own base price: a
      // leftover price rule on a test product makes the price read and the
      // cart disagree, and the order then lands in "Payment error".
      const base = Number((await ps.getProduct(externalId).catch(() => null))?.price ?? NaN);
      if (!(Math.abs(base - home.net) < 0.005)) continue;
      const buyer =
        countryId === homeCountryId
          ? home
          : await ps.getProductPrices(externalId, countryId, combinationId).catch(() => null);
      if (!buyer || !(Math.abs(base - buyer.net) < 0.005)) continue;
      return { product, variant, gross: Math.round(buyer.gross * 100) / 100 };
    }
    if (page.items.length < 50) break;
  }
  return undefined;
}

/** `synthesizeOrder` with a 23% product and, unless asked otherwise, PLN. */
export async function ksefOrder(
  ctx: { api: ApiClient; world: World; jobs: SyncJobs; poll: Poller },
  options: SynthesizeOrderOptions & {
    /**
     * The catalogue rate the product must carry. `null` picks one the catalogue
     * holds no rate for, so the line falls back to the connection default -
     * the only case the cross-border guard exists for (ADR-063).
     */
    catalogueRate?: '23' | null;
  } = {}
): Promise<SynthesizedOrder> {
  const store = resolvePrestashopStore(ctx.world);
  const ps = buildPrestashopWebserviceClient(ctx.world);
  if (!store || !ps) throw new Error('ksefOrder needs a PrestaShop store and webservice key');
  const countryId = await ps.getCountryIdByIso((options.buyerCountryIso ?? 'PL').toUpperCase());
  if (!countryId)
    throw new Error(`ksefOrder: the shop has no country ${options.buyerCountryIso ?? 'PL'}`);
  const homeCountryId = (await ps.getCountryIdByIso('PL')) ?? countryId;
  const picked = await pickTaxedDriver(
    ctx.api,
    ps,
    store.id,
    countryId,
    homeCountryId,
    options.catalogueRate ?? '23'
  );
  if (!picked)
    throw new Error(
      `ksefOrder found no product the shop still has with catalogue rate ${String(options.catalogueRate ?? '23')}`
    );
  const currencyId = options.currencyId ?? (await ps.getCurrencyIdByIso('PLN')) ?? undefined;
  // A cart in another currency converts the catalogue price at the shop's own
  // rate; the posted amount has to match that, not the default-currency price.
  // PrestaShop leaves a price in the shop's default currency (PLN here) as it
  // is and multiplies it by the target currency's stored rate otherwise. The
  // default's own stored rate is NOT 1 on this shop (PLN carries 4.3), so it
  // must not be applied.
  const plnId = await ps.getCurrencyIdByIso('PLN');
  const targetRate =
    currencyId && currencyId !== plnId
      ? await ps.getCurrencyConversionRate(currencyId).catch(() => null)
      : null;
  const ratio = targetRate ?? 1;
  const gross = Math.round(picked.gross * ratio * 100) / 100;
  // The catalogue price is net; paying it as gross makes PrestaShop's own total
  // disagree with the posted one, and it then refuses to save the payment.
  return synthesizeOrder(ctx, {
    ...options,
    driver: options.driver ?? { product: picked.product, variant: picked.variant },
    unitPriceTaxIncl: options.unitPriceTaxIncl ?? gross,
    ...(currencyId ? { currencyId } : {}),
  });
}
