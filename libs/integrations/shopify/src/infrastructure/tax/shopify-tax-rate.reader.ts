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
 *     unreadable`, which core does not persist;
 *   - the app lacks the optional `write_draft_orders` scope -> `unknown /
 *     unreadable` too, warned once per resolution: the catalogue syncs and
 *     every rate stays "not checked" until the scope is granted. Unlike the
 *     other unreadable answers this one is not transient, so it is remembered
 *     per connection for 15 minutes: without that, a tax-exclusive shop would
 *     send a refused calculation (and spend the store's shared budget) on
 *     every product read, and granting the scope still shows on the next sync.
 * A transport or auth failure throws, as the capability contract asks.
 *
 * Tax lines come per order, not per line item, which is why the read sends ONE
 * variant and no shipping line: every tax line then belongs to that variant.
 *
 * Sales country: `config.salesCountryIso2`, else the shop's own billing
 * country. When it is the shop's own country the shop's province and zip go
 * with it, which a US calculation needs.
 *
 * Cached per variant and country for a day, so a sweep does not spend a
 * calculation (a mutation, 10 cost points) per product per tick. The key holds
 * no `updatedAt` on purpose: a stock change bumps the product's and the
 * variant's `updatedAt` (L-M2), which would re-run the calculation on every
 * stock change, while the things that do change the rate - a collection tax
 * override, the variant's `taxable` flag - are seen when the day runs out.
 * An unknown answer (no tax line, several, no rate) is kept only 15 minutes:
 * it is usually the shop's tax setup being unfinished, and the operator who
 * finishes it should see rates and prices on the next sync, not tomorrow.
 *
 * @module libs/integrations/shopify/src/infrastructure/tax
 */
import type { TaxRateResolution } from '@openlinker/core/products';
import type { CachePort } from '@openlinker/shared';

import { Logger } from '@openlinker/shared/logging';

import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';
import { ShopifyUserErrorsException } from '../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../domain/policies/shopify-gid.policy';
import type { ShopifyTaxLine } from '../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';
import { DRAFT_ORDER_TAX_QUERY } from '../readers/shopify-product.queries';
import type { ShopifyShopContextProvider } from '../shop-context/shopify-shop-context.provider';

const CACHE_TTL_SECONDS = 86_400;
const UNKNOWN_CACHE_TTL_SECONDS = 900;

const SCOPE_MISSING: TaxRateResolution = {
  kind: 'unknown',
  reason: 'unreadable',
  detail: 'the app lacks the write_draft_orders scope',
};

interface DraftOrderTaxPayload {
  readonly calculatedDraftOrder: {
    readonly taxLines: readonly ShopifyTaxLine[];
    readonly lineItems: ReadonlyArray<{ readonly taxable: boolean }>;
  } | null;
}

export interface ShopifyTaxRateRead {
  /** Variant GID or numeric id. */
  readonly variantId: string;
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
  private readonly logger = new Logger(ShopifyTaxRateReader.name);
  private scopeWarned = false;

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

    const scopeKey = `shopify:tax-scope-missing:${this.connectionId}`;
    if ((await this.readCache(scopeKey)) !== null) {
      return SCOPE_MISSING;
    }

    const key = `shopify:tax-rate:${this.connectionId}:${fromShopifyGid(input.variantId)}:${country}`;
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
    if (resolution === SCOPE_MISSING) {
      await this.writeCache(scopeKey, resolution);
    } else if (resolution.kind !== 'unknown' || resolution.reason !== 'unreadable') {
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
      if (error instanceof ShopifyGraphqlError && error.isAccessDenied()) {
        if (!this.scopeWarned) {
          this.scopeWarned = true;
          this.logger.warn(
            `Shopify tax rates are not read: the app lacks the optional write_draft_orders scope ` +
              `(connection: ${this.connectionId})`,
          );
        }
        return SCOPE_MISSING;
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
      const ttl = resolution.kind === 'resolved' ? CACHE_TTL_SECONDS : UNKNOWN_CACHE_TTL_SECONDS;
      await this.cache.set(key, resolution, ttl).catch(() => undefined);
    }
  }
}
