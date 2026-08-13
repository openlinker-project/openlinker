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
 *
 * **"Untaxed" and "unknown" are different answers (#2052).** A product whose
 * `id_tax_rules_group` is an explicit `0` resolves to `0` — that is the "No tax"
 * entry in PrestaShop's own product dropdown, i.e. a deliberate operator
 * statement, and blocking on it would refuse every intentionally exempt
 * product. An *absent* or unparseable group is a different thing entirely (the
 * read did not state the product's tax status), so the three cases stay
 * distinguishable. Everything that means "the read did not tell me the rate"
 * reports `kind: 'unknown'`, because the caller pins a tax-EXCLUDED price and a
 * `0` it cannot trust silently mis-prices the order (#895 / ADR-014). Only a
 * resolved rate is cached: caching an unknown would keep the wrong answer alive
 * for the rest of the TTL and make an operator's fix look like it did nothing.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import { PrestashopApiException } from '../../domain/exceptions/prestashop-api.exception';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { PrestashopCountryResolver } from './prestashop-country-resolver';
import type {
  PrestashopTaxRateResolution,
  PrestashopTaxRateUnknown,
} from './prestashop-tax-rate.types';
import { TAX_RATE_EVIDENCE_DETAIL_MAX } from './prestashop-tax-rate.types';

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
   * Resolve the effective tax rate PS applies to `externalProductId` for an
   * order delivered to `deliveryCountryIso`.
   *
   * Reports `{ kind: 'resolved', rate }` (a fraction, e.g. `0.23`) when the
   * shop answered — including the legitimate `0` of a "No tax" product — and
   * `{ kind: 'unknown', reason, evidence }` when it did not. Callers that
   * convert gross to net MUST branch on `kind`; treating an unknown as `0`
   * pins the gross price as net (the #2052 defect).
   */
  async resolveProductTaxRate(
    externalProductId: string | number,
    deliveryCountryIso: string | undefined,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<PrestashopTaxRateResolution> {
    const countryId = await this.resolveCountryIdSafe(
      deliveryCountryIso,
      connectionId,
      webserviceClient
    );

    const cacheKey = `${connectionId}:${externalProductId}:${countryId ?? 'none'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { kind: 'resolved', rate: cached.rate };
    }

    const resolution = await this.computeRate(externalProductId, countryId, webserviceClient);
    // Only a resolved rate enters the cache. An unknown is a condition an
    // operator fixes in the shop's admin and then retries — a cached unknown
    // would answer the retry from memory for up to the TTL and read as "the
    // fix did not work".
    if (resolution.kind === 'resolved') {
      this.cache.set(cacheKey, { rate: resolution.rate, timestamp: Date.now() });
    }
    return resolution;
  }

  private async computeRate(
    externalProductId: string | number,
    countryId: number | undefined,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<PrestashopTaxRateResolution> {
    let product: PrestashopProductTaxRow | undefined;
    try {
      product = await webserviceClient.getResource<PrestashopProductTaxRow>(
        'products',
        externalProductId
      );
    } catch (error) {
      return this.transportUnknown(`products/${externalProductId}`, error, externalProductId);
    }

    const rawGroup = product?.id_tax_rules_group;
    if (rawGroup === undefined || rawGroup === null || String(rawGroup).trim() === '') {
      // The read succeeded and did not carry the field at all. That is NOT the
      // "No tax" dropdown entry below — PrestaShop states that as an explicit
      // `0` — it is a payload that cannot be priced with (a `display` filter, a
      // partial response, schema drift). Collapsing the two was the surviving
      // half of the #2052 defect: it priced gross as net AND cached the answer.
      this.logger.warn(
        `Tax rate unknown for product ${externalProductId}: products/${externalProductId} ` +
          `carries no tax-rule group field.`
      );
      return {
        kind: 'unknown',
        reason: 'configuration',
        evidence: `products/${externalProductId} carries no tax-rule group`,
      };
    }

    const groupId = Number.parseInt(String(rawGroup), 10);
    if (!Number.isFinite(groupId) || groupId < 0) {
      this.logger.warn(
        `Tax rate unknown for product ${externalProductId}: products/${externalProductId} reports ` +
          `an unusable tax-rule group '${String(rawGroup)}'.`
      );
      return {
        kind: 'unknown',
        reason: 'configuration',
        evidence: `products/${externalProductId} reports an unusable tax-rule group '${this.cap(String(rawGroup))}'`,
      };
    }

    if (groupId === 0) {
      // `id_tax_rules_group = 0` is the "No tax" entry in PrestaShop's product
      // dropdown — a deliberate exemption, NOT missing data, so it stays a
      // resolved 0 (#2052). Warned rather than silent so an operator who did
      // not mean to exempt the product can still find it in the logs.
      this.logger.warn(
        `Product ${externalProductId} has no tax-rule group (PrestaShop "No tax"); pricing it as untaxed.`
      );
      return { kind: 'resolved', rate: 0 };
    }

    let rules: PrestashopTaxRuleRow[];
    try {
      rules = await webserviceClient.listResources<PrestashopTaxRuleRow>('tax_rules', {
        custom: { id_tax_rules_group: groupId },
      });
    } catch (error) {
      return this.transportUnknown(
        `tax_rules?id_tax_rules_group=${groupId}`,
        error,
        externalProductId
      );
    }

    const rule = this.selectRule(rules, countryId);
    if (!rule || !rule.id_tax) {
      this.logger.warn(
        `No usable tax rule for group ${groupId} (product ${externalProductId}); treating as untaxed.`
      );
      return { kind: 'resolved', rate: 0 };
    }

    let tax: PrestashopTaxRow | undefined;
    try {
      tax = await webserviceClient.getResource<PrestashopTaxRow>('taxes', rule.id_tax);
    } catch (error) {
      return this.transportUnknown(`taxes/${rule.id_tax}`, error, externalProductId);
    }

    const rawRate = tax?.rate;
    if (rawRate === undefined || rawRate === null || String(rawRate).trim() === '') {
      // The read succeeded and carries no `rate` field at all. Pre-#2052 this
      // was the worst of the zero paths: `String(undefined ?? '0')` parsed to a
      // finite, non-negative 0 and flowed out as a SUCCESS.
      this.logger.warn(
        `Tax rate unknown for product ${externalProductId}: tax rule ${rule.id_tax} in group ` +
          `${groupId} carries no rate.`
      );
      return {
        kind: 'unknown',
        reason: 'configuration',
        evidence: `tax rule ${rule.id_tax} in group ${groupId} carries no rate`,
      };
    }

    const ratePercent = Number.parseFloat(String(rawRate));
    if (!Number.isFinite(ratePercent) || ratePercent < 0) {
      this.logger.warn(
        `Tax rate unknown for product ${externalProductId}: tax rule ${rule.id_tax} in group ` +
          `${groupId} reports an unusable rate '${String(rawRate)}'.`
      );
      return {
        kind: 'unknown',
        reason: 'configuration',
        evidence: `tax rule ${rule.id_tax} in group ${groupId} reports an unusable rate '${this.cap(String(rawRate))}'`,
      };
    }
    return { kind: 'resolved', rate: ratePercent / 100 };
  }

  /**
   * Report a failed read as a transport unknown. Every read on the resolution
   * chain goes through here — `products`, `tax_rules` and `taxes` alike — so a
   * 503 on any of them produces the same operator-facing sentence and stays
   * retryable, instead of escaping as a bare error the caller then wraps in its
   * generic `Failed to create PrestaShop order:` prefix (#2052 review).
   */
  private transportUnknown(
    read: string,
    error: unknown,
    externalProductId: string | number
  ): PrestashopTaxRateUnknown {
    const statusCode = error instanceof PrestashopApiException ? error.statusCode : undefined;
    const detail =
      statusCode !== undefined
        ? `returned ${statusCode}`
        : `failed (${this.cap(error instanceof Error ? error.message : String(error))})`;
    const evidence = `GET ${read} ${detail}`;
    this.logger.warn(
      `Could not read the tax rate for product ${externalProductId}; reporting it as unknown. ${evidence}`
    );
    return { kind: 'unknown', reason: 'transport', evidence, statusCode };
  }

  /** Keep operator-facing evidence short — it is rendered, not logged. */
  private cap(value: string): string {
    return value.length > TAX_RATE_EVIDENCE_DETAIL_MAX
      ? `${value.slice(0, TAX_RATE_EVIDENCE_DETAIL_MAX)}…`
      : value;
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
      // Warn, not debug (#2052): falling through to the catch-all rule can
      // silently pick a different rate than the delivery country's, which is a
      // pricing decision the operator should be able to find in the logs.
      this.logger.warn(
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
