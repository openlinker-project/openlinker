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
 * by default), else the catch-all (`id_country = 0`) rule. Where neither singles
 * a rule out it reports `ambiguous` rather than taking whichever row the
 * webservice listed first: since #2245 the same resolver also states the rate a
 * fiscal document carries, and an arbitrary pick there is a wrong VAT rate on an
 * invoice rather than a slightly-off net price.
 *
 * **"Untaxed" and "unknown" are different answers (#2052).** A product whose
 * `id_tax_rules_group` reads `0` resolves to `0` — that is the "No tax" entry in
 * PrestaShop's own product dropdown, i.e. a deliberate operator statement, and
 * blocking on it would refuse every intentionally exempt product. A *missing*
 * field reads the same way, because PrestaShop's webservice omits a zero-valued
 * `id_*` field instead of emitting `0`. An *unparseable* group is a different
 * thing entirely (the read did not state the product's tax status). Everything
 * that means "the read did not tell me the rate"
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
import { readAllPrestashopResourcePages } from '../http/prestashop-paged-read';

/**
 * The only field this resolver reads off a product. Exported so a caller that
 * has already fetched the product can name what it is handing over (#2592).
 */
export interface PrestashopProductTaxRow {
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

/**
 * Cap on live cache entries, enforced by a sweep on insert.
 *
 * This is the only cache on the PrestaShop resolvers whose key space grows with
 * SKU count, and since #2592 the resolver lives for the process. Nothing reads
 * an entry again after a sweep moves on, so an expired entry is never evicted
 * by the read path: a 100k-SKU catalogue sweep would leave 100k dead entries
 * behind for the rest of the process's life. The cap is generous enough that a
 * normal sweep never touches it and small enough that the worst case stays a
 * few megabytes.
 */
const MAX_CACHE_ENTRIES = 20_000;

interface CacheEntry {
  rate: number;
  timestamp: number;
}

/**
 * What the rule walk concluded. A discriminated result rather than
 * `rule | undefined`, because "no rule at all" and "several and I cannot
 * choose" are different answers to the operator and were both collapsed into a
 * fabricated 0% before (#2245 review).
 */
type TaxRuleSelection =
  /** `taxId` is carried resolved: only a rule naming a usable tax gets here. */
  | { kind: 'rule'; taxId: number }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidateTaxIds: string[] };

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
    webserviceClient: IPrestashopWebserviceClient,
    /**
     * The product resource, when the caller has already fetched it (#2592).
     *
     * All this resolver reads off the product is `id_tax_rules_group`, and the
     * catalogue sweep has just fetched the very same resource one call earlier.
     * Without this the shop served `products/{id}` a second time for every SKU
     * on every sweep - measured at 1.00 extra request per SKU after the
     * per-instance memo had already collapsed the master sync's own two reads
     * into one.
     *
     * Omitting it keeps the previous behaviour exactly: the resolver fetches
     * the product itself.
     */
    preloadedProduct?: PrestashopProductTaxRow
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

    const resolution = await this.computeRate(
      externalProductId,
      countryId,
      webserviceClient,
      connectionId,
      preloadedProduct
    );
    // Only a resolved rate enters the cache. An unknown is a condition an
    // operator fixes in the shop's admin and then retries — a cached unknown
    // would answer the retry from memory for up to the TTL and read as "the
    // fix did not work".
    if (resolution.kind === 'resolved') {
      this.sweepIfAtCapacity();
      this.cache.set(cacheKey, { rate: resolution.rate, timestamp: Date.now() });
    }
    return resolution;
  }

  /** Clear the cache for one connection, or all connections when omitted. */
  clearCache(connectionId?: string): void {
    if (connectionId === undefined) {
      this.cache.clear();
      this.countryResolver.clearCache();
      return;
    }
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${connectionId}:`)) {
        this.cache.delete(key);
      }
    }
    // The country resolver is private to this resolver, so nothing else can
    // reach it to invalidate the country-id rows behind these rates.
    this.countryResolver.clearCache(connectionId);
  }

  private sweepIfAtCapacity(): void {
    if (this.cache.size < MAX_CACHE_ENTRIES) {
      return;
    }
    const now = Date.now();
    for (const [key, entry] of [...this.cache.entries()]) {
      if (now - entry.timestamp >= CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    }
    // Everything still live and still at the cap means a burst wider than the
    // cap inside one TTL. Dropping the lot costs re-reads, never a wrong rate.
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      this.cache.clear();
    }
  }

  private async computeRate(
    externalProductId: string | number,
    countryId: number | undefined,
    webserviceClient: IPrestashopWebserviceClient,
    connectionId: string,
    preloadedProduct?: PrestashopProductTaxRow
  ): Promise<PrestashopTaxRateResolution> {
    let product: PrestashopProductTaxRow | undefined = preloadedProduct;
    if (product === undefined) {
      try {
        product = await webserviceClient.getResource<PrestashopProductTaxRow>(
          'products',
          externalProductId
        );
      } catch (error) {
        return this.transportUnknown(`products/${externalProductId}`, error, externalProductId);
      }
    }

    const rawGroup = product?.id_tax_rules_group;
    const groupAbsent =
      rawGroup === undefined || rawGroup === null || String(rawGroup).trim() === '';

    const groupId = groupAbsent ? 0 : Number.parseInt(String(rawGroup), 10);
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
      //
      // An ABSENT field lands here too, because PrestaShop's webservice OMITS a
      // zero-valued `id_*` field rather than emitting `0`: a real `GET
      // /products/{id}` on a "No tax" product carries no `id_tax_rules_group`
      // at all (alongside the equally-absent `id_manufacturer` /
      // `id_supplier`), while a non-zero `id_category_default` is present.
      // Reporting absence as `unknown` therefore blocked EVERY intentionally
      // exempt product — the opposite of what #2052 set out to protect. The
      // genuinely unpriceable readings stay `unknown`: an unusable group value,
      // a rate field the shop answered without, and any transport failure.
      this.logger.warn(
        `Product ${externalProductId} has no tax-rule group (PrestaShop "No tax"); pricing it as untaxed.`
      );
      return { kind: 'resolved', rate: 0 };
    }

    let rules: PrestashopTaxRuleRow[];
    try {
      // Paged: a tax-rule group can carry a rule per country and state, which is
      // past one page on a shop that sells widely. A cut page hides the buyer's
      // own country's rule, and `selectRule` then reports no usable rule at all
      // for a shop that has one (#2608).
      rules = await readAllPrestashopResourcePages<PrestashopTaxRuleRow>(
        webserviceClient,
        'tax_rules',
        { custom: { id_tax_rules_group: groupId } },
        {
          connectionId,
          detail: `id_tax_rules_group=${String(groupId)}`,
        }
      );
    } catch (error) {
      return this.transportUnknown(
        `tax_rules?id_tax_rules_group=${groupId}`,
        error,
        externalProductId
      );
    }

    const selection = this.selectRule(rules, countryId);
    if (selection.kind === 'none') {
      // NOT a resolved zero. The absence of a usable rule is the shop failing
      // to say what it charges, and `0` is a rate a document then STATES - so
      // inferring one here put an unclaimed 0% VAT on invoices and receipts
      // (#2245 review). A deliberate zero still resolves: it arrives as
      // `id_tax_rules_group = 0` above, which is PrestaShop's own "No tax"
      // choice and is handled before this point.
      this.logger.warn(
        `Tax rate unknown for product ${externalProductId}: tax-rule group ${groupId} has no usable rule.`
      );
      return {
        kind: 'unknown',
        reason: 'configuration',
        evidence: `tax-rule group ${groupId} has no usable rule`,
      };
    }
    if (selection.kind === 'ambiguous') {
      // Several candidate rules pointing at different taxes and nothing that
      // singles one out - no delivery country matched, and no catch-all row.
      // The pre-review code returned `rules[0]`, i.e. whichever row the
      // webservice happened to list first, so a PL shop with per-country rules
      // could project DE 19% onto every line.
      this.logger.warn(
        `Tax rate unknown for product ${externalProductId}: tax-rule group ${groupId} offers ` +
          `${String(selection.candidateTaxIds.length)} candidate rates with no unambiguous pick.`
      );
      return {
        kind: 'unknown',
        reason: 'ambiguous',
        evidence:
          `tax-rule group ${groupId} offers ${String(selection.candidateTaxIds.length)} candidate ` +
          `rates (taxes ${this.cap(selection.candidateTaxIds.join(', '))}) with no unambiguous pick`,
      };
    }
    const taxId = selection.taxId;

    let tax: PrestashopTaxRow | undefined;
    try {
      tax = await webserviceClient.getResource<PrestashopTaxRow>('taxes', String(taxId));
    } catch (error) {
      return this.transportUnknown(`taxes/${taxId}`, error, externalProductId);
    }

    const rawRate = tax?.rate;
    if (rawRate === undefined || rawRate === null || String(rawRate).trim() === '') {
      // The read succeeded and carries no `rate` field at all. Pre-#2052 this
      // was the worst of the zero paths: `String(undefined ?? '0')` parsed to a
      // finite, non-negative 0 and flowed out as a SUCCESS.
      this.logger.warn(
        `Tax rate unknown for product ${externalProductId}: tax rule ${taxId} in group ` +
          `${groupId} carries no rate.`
      );
      return {
        kind: 'unknown',
        reason: 'configuration',
        evidence: `tax rule ${taxId} in group ${groupId} carries no rate`,
      };
    }

    const ratePercent = Number.parseFloat(String(rawRate));
    if (!Number.isFinite(ratePercent) || ratePercent < 0) {
      this.logger.warn(
        `Tax rate unknown for product ${externalProductId}: tax rule ${taxId} in group ` +
          `${groupId} reports an unusable rate '${String(rawRate)}'.`
      );
      return {
        kind: 'unknown',
        reason: 'configuration',
        evidence: `tax rule ${taxId} in group ${groupId} reports an unusable rate '${this.cap(String(rawRate))}'`,
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
   * (`id_country = 0`) rule - and reporting *ambiguous* rather than guessing
   * when neither singles a rule out.
   *
   * Three answers, mirroring what the WooCommerce master reports for the same
   * shapes (`not-configured` / `ambiguous` / a rate):
   *
   * - `none` - no rule carries a usable `id_tax`. The shop has not said what it
   *   charges for this group.
   * - `rule` - one rule, or several that all point at the SAME tax. Several
   *   rows agreeing is not ambiguous: the answer is the same whichever the shop
   *   picks (the rule WooCommerce's `distinctRates` dedup already follows).
   * - `ambiguous` - several candidate taxes and nothing that singles one out.
   *
   * Among rows matching the country, the country-level rule (`id_state = 0`) is
   * the unambiguous pick over state-specific rows; a multi-state group with no
   * country-level row (e.g. US) is genuinely ambiguous rather than "whichever
   * state came first".
   */
  private selectRule(
    rules: PrestashopTaxRuleRow[],
    countryId: number | undefined
  ): TaxRuleSelection {
    if (!rules || rules.length === 0) {
      return { kind: 'none' };
    }
    // A rule with no (or a zero) `id_tax` names no tax record, so it is not a
    // candidate for anything.
    const usable = rules.filter((r) => this.toInt(r.id_tax) > 0);
    if (usable.length === 0) {
      return { kind: 'none' };
    }

    if (countryId !== undefined) {
      const countryMatches = usable.filter((r) => this.toInt(r.id_country) === countryId);
      if (countryMatches.length > 0) {
        const countryLevel = countryMatches.find((r) => this.toInt(r.id_state) === 0);
        if (countryLevel) {
          return { kind: 'rule', taxId: this.toInt(countryLevel.id_tax) };
        }
        return this.singleTaxOrAmbiguous(countryMatches);
      }
    }

    const catchAll = usable.filter((r) => this.toInt(r.id_country) === 0);
    if (catchAll.length > 0) {
      return this.singleTaxOrAmbiguous(catchAll);
    }
    return this.singleTaxOrAmbiguous(usable);
  }

  /**
   * One candidate tax across the rows resolves; more than one is ambiguous.
   * Deduplicated by `id_tax` rather than by rate, so it costs no extra read -
   * two rows naming one tax record cannot disagree about its rate.
   */
  private singleTaxOrAmbiguous(rules: PrestashopTaxRuleRow[]): TaxRuleSelection {
    const taxIds = [...new Set(rules.map((r) => this.toInt(r.id_tax)))];
    if (taxIds.length === 1) {
      return { kind: 'rule', taxId: taxIds[0] };
    }
    return { kind: 'ambiguous', candidateTaxIds: taxIds.map((id) => String(id)) };
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
