/**
 * PrestaShop Tax-Rate Resolver
 *
 * Resolves the effective tax rate PrestaShop applies to a product, so the order
 * processor can convert a buyer-paid GROSS line price into the tax-EXCLUDED
 * `specific_prices.price` PrestaShop expects, and rely on PS to re-apply the
 * same rate and reproduce the buyer-paid gross on the order line
 * (#895 / ADR-014).
 *
 * The rate is destination-catalog knowledge resolved entirely here — it never
 * leaks onto the core order contract. Resolution walks
 * product → `id_tax_rules_group` → `tax_rules` → `taxes`, selecting the rule for
 * the order's delivery country when resolvable (PS taxes on the delivery address
 * by default), else the catch-all (`id_country = 0`) rule, else the first rule.
 * A product with no tax-rule group (or an unresolvable rate) yields `0`.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { PrestashopCountryResolver } from './prestashop-country-resolver';

interface PrestashopProductTaxRow {
  id_tax_rules_group?: string | number;
}

interface PrestashopTaxRuleRow {
  id_tax?: string | number;
  id_country?: string | number;
  id_state?: string | number;
}

interface PrestashopTaxRow {
  rate?: string | number;
}

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  rate: number;
  timestamp: number;
}

export class PrestashopTaxRateResolver {
  private readonly logger = new Logger(PrestashopTaxRateResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly countryResolver: PrestashopCountryResolver) {}

  /**
   * Resolve the effective tax rate (as a fraction, e.g. `0.23` for 23%) PS
   * applies to `externalProductId` for an order delivered to
   * `deliveryCountryIso`. Returns `0` when the product is untaxed or the rate
   * cannot be resolved.
   */
  async resolveProductTaxRate(
    externalProductId: string | number,
    deliveryCountryIso: string | undefined,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<number> {
    const countryId = await this.resolveCountryIdSafe(
      deliveryCountryIso,
      connectionId,
      webserviceClient
    );

    const cacheKey = `${connectionId}:${externalProductId}:${countryId ?? 'none'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.rate;
    }

    const rate = await this.computeRate(externalProductId, countryId, webserviceClient);
    this.cache.set(cacheKey, { rate, timestamp: Date.now() });
    return rate;
  }

  private async computeRate(
    externalProductId: string | number,
    countryId: number | undefined,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<number> {
    let groupId: number;
    try {
      const product = await webserviceClient.getResource<PrestashopProductTaxRow>(
        'products',
        externalProductId
      );
      groupId = this.toInt(product?.id_tax_rules_group);
    } catch (error) {
      this.logger.warn(
        `Could not read tax-rule group for product ${externalProductId}; treating as untaxed. ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return 0;
    }

    if (!groupId) {
      // 0 / missing → product carries no tax rule.
      return 0;
    }

    const rules = await webserviceClient.listResources<PrestashopTaxRuleRow>('tax_rules', {
      custom: { id_tax_rules_group: groupId },
    });
    const rule = this.selectRule(rules, countryId);
    if (!rule || !rule.id_tax) {
      this.logger.warn(
        `No usable tax rule for group ${groupId} (product ${externalProductId}); treating as untaxed.`
      );
      return 0;
    }

    const tax = await webserviceClient.getResource<PrestashopTaxRow>('taxes', rule.id_tax);
    const ratePercent = Number.parseFloat(String(tax?.rate ?? '0'));
    if (!Number.isFinite(ratePercent) || ratePercent < 0) {
      return 0;
    }
    return ratePercent / 100;
  }

  /**
   * Pick the tax rule for the delivery country, falling back to the catch-all
   * (`id_country = 0`) rule and finally the first rule. Among rows matching the
   * country, prefer the country-level rule (`id_state = 0`) over state-specific
   * rows so a multi-state group (e.g. US) doesn't return an arbitrary state rate.
   */
  private selectRule(
    rules: PrestashopTaxRuleRow[],
    countryId: number | undefined
  ): PrestashopTaxRuleRow | undefined {
    if (!rules || rules.length === 0) {
      return undefined;
    }
    if (countryId !== undefined) {
      const countryMatches = rules.filter((r) => this.toInt(r.id_country) === countryId);
      if (countryMatches.length > 0) {
        return countryMatches.find((r) => this.toInt(r.id_state) === 0) ?? countryMatches[0];
      }
    }
    const catchAll = rules.find((r) => this.toInt(r.id_country) === 0);
    return catchAll ?? rules[0];
  }

  private async resolveCountryIdSafe(
    deliveryCountryIso: string | undefined,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<number | undefined> {
    if (!deliveryCountryIso) {
      return undefined;
    }
    try {
      return await this.countryResolver.resolveCountryId(
        deliveryCountryIso,
        connectionId,
        webserviceClient
      );
    } catch (error) {
      this.logger.debug(
        `Could not resolve delivery country '${deliveryCountryIso}'; using catch-all tax rule. ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  private toInt(value: string | number | undefined): number {
    if (value === undefined || value === null) {
      return 0;
    }
    const n = Number.parseInt(String(value), 10);
    return Number.isNaN(n) ? 0 : n;
  }
}
