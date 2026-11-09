/**
 * Shopify Tax Rate Reader
 *
 * Shopify stores no tax rate on a product (L-T2): it works one out at sale
 * time from the buyer's region, the shop's tax settings and per-collection
 * overrides. So the rate is COMPUTED (L-T4): `draftOrderCalculate` with one
 * variant, quantity 1 and a shipping address in the sales country returns the
 * tax lines Shopify would charge, without creating anything.
 *
 * The answer, in the `TaxRateResolution` vocabulary:
 *   - the variant is not taxable (`taxable: false`, the shop's own "charge no
 *     tax" choice) -> `resolved '0'`;
 *   - exactly one tax line -> `resolved` with its percentage as the code;
 *   - no tax line on a taxable variant -> `unknown / not-configured` (the shop
 *     collects no tax for that country, e.g. no tax region set up);
 *   - several tax lines (a US state + county split, for one) -> `unknown /
 *     ambiguous`: one code cannot state them;
 *   - Shopify refused the calculation or answered nothing -> `unknown /
 *     unreadable`, which core does not persist.
 * A transport, auth or scope failure throws, as the capability contract asks.
 *
 * Tax lines come per order, not per line item, which is why the read sends ONE
 * variant and no shipping line: every tax line then belongs to that variant.
 *
 * Sales country: `config.salesCountryIso2`, else the shop's own billing
 * country. When it is the shop's own country the shop's province and zip go
 * with it, which a US calculation needs.
 *
 * Cached per variant, country and the product's `updatedAt` for a day, so a
 * sweep does not spend a calculation per product per tick, while an edit to
 * the product reads the rate again. A change to a collection tax override does
 * not touch the product, so it is seen when the day runs out.
 *
 * @module libs/integrations/shopify/src/infrastructure/tax
 */
import type { TaxRateResolution } from '@openlinker/core/products';
import type { CachePort } from '@openlinker/shared';

import { ShopifyUserErrorsException } from '../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../domain/policies/shopify-gid.policy';
import type { ShopifyTaxLine } from '../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';
import { DRAFT_ORDER_TAX_QUERY } from '../readers/shopify-product.queries';
import type { ShopifyShopContextProvider } from '../shop-context/shopify-shop-context.provider';

const CACHE_TTL_SECONDS = 86_400;

interface DraftOrderTaxPayload {
  readonly calculatedDraftOrder: {
    readonly taxLines: readonly ShopifyTaxLine[];
    readonly lineItems: ReadonlyArray<{ readonly taxable: boolean }>;
  } | null;
}

export interface ShopifyTaxRateRead {
  /** Variant GID or numeric id. */
  readonly variantId: string;
  /** The product's `updatedAt`, part of the cache key. */
  readonly productUpdatedAt: string;
}

/** A percentage as a rate code: `23` -> `'23'`, `5.5` -> `'5.5'`. */
export function shopifyRateCode(line: ShopifyTaxLine): string | null {
  const percent =
    typeof line.ratePercentage === 'number'
      ? line.ratePercentage
      : typeof line.rate === 'number'
        ? line.rate * 100
        : null;
  if (percent === null || !Number.isFinite(percent) || percent < 0) {
    return null;
  }
  return String(Number(percent.toFixed(4)));
}

export class ShopifyTaxRateReader {
  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly connectionId: string,
    private readonly configuredCountry: string | null,
    private readonly cache: CachePort | undefined,
  ) {}

  async read(input: ShopifyTaxRateRead): Promise<TaxRateResolution> {
    const { shopAddress } = await this.shopContext.get();
    const country = this.configuredCountry ?? shopAddress?.countryCodeV2 ?? null;
    if (country === null) {
      return {
        kind: 'unknown',
        reason: 'not-configured',
        detail: 'no sales country: set salesCountryIso2 on the connection or a billing address on the shop',
      };
    }

    const key =
      `shopify:tax-rate:${this.connectionId}:${fromShopifyGid(input.variantId)}:` +
      `${country}:${input.productUpdatedAt}`;
    const cached = await this.readCache(key);
    if (cached !== null) {
      return cached;
    }

    const ownCountry = shopAddress !== null && shopAddress.countryCodeV2 === country;
    const resolution = await this.calculate(input.variantId, {
      countryCode: country,
      ...(ownCountry && shopAddress.provinceCode !== null ? { provinceCode: shopAddress.provinceCode } : {}),
      ...(ownCountry && shopAddress.zip !== null ? { zip: shopAddress.zip } : {}),
    });
    if (resolution.kind !== 'unknown' || resolution.reason !== 'unreadable') {
      await this.writeCache(key, resolution);
    }
    return resolution;
  }

  private async calculate(
    variantId: string,
    shippingAddress: Readonly<Record<string, string>>,
  ): Promise<TaxRateResolution> {
    let payload: DraftOrderTaxPayload;
    try {
      payload = await this.client.mutate<DraftOrderTaxPayload>(
        DRAFT_ORDER_TAX_QUERY,
        {
          input: {
            lineItems: [{ variantId: toShopifyGid('ProductVariant', variantId), quantity: 1 }],
            shippingAddress,
          },
        },
        'draftOrderCalculate',
      );
    } catch (error) {
      if (error instanceof ShopifyUserErrorsException) {
        return { kind: 'unknown', reason: 'unreadable', detail: error.message.slice(0, 200) };
      }
      throw error;
    }

    const calculated = payload.calculatedDraftOrder;
    if (calculated === null) {
      return { kind: 'unknown', reason: 'unreadable', detail: 'Shopify calculated no draft order' };
    }
    if (calculated.lineItems[0]?.taxable === false) {
      return { kind: 'resolved', code: '0', countryIso2: shippingAddress.countryCode };
    }
    const lines = calculated.taxLines;
    if (lines.length === 0) {
      return {
        kind: 'unknown',
        reason: 'not-configured',
        detail: `Shopify charges no tax for ${shippingAddress.countryCode}`,
      };
    }
    if (lines.length > 1) {
      return {
        kind: 'unknown',
        reason: 'ambiguous',
        detail: `Shopify charges ${lines.length} taxes for ${shippingAddress.countryCode}: ${lines
          .map((l) => l.title)
          .join(', ')}`.slice(0, 200),
      };
    }
    const code = shopifyRateCode(lines[0]);
    if (code === null) {
      return { kind: 'unknown', reason: 'unreadable', detail: 'Shopify tax line carries no rate' };
    }
    return { kind: 'resolved', code, countryIso2: shippingAddress.countryCode };
  }

  private async readCache(key: string): Promise<TaxRateResolution | null> {
    if (this.cache === undefined) {
      return null;
    }
    return this.cache.get<TaxRateResolution>(key).catch(() => null);
  }

  private async writeCache(key: string, resolution: TaxRateResolution): Promise<void> {
    if (this.cache !== undefined) {
      await this.cache.set(key, resolution, CACHE_TTL_SECONDS).catch(() => undefined);
    }
  }
}
