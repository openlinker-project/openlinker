/**
 * WooCommerce Tax Class Resolver (#3505, G01-6)
 *
 * With WooCommerce taxes switched on (`woocommerce_calc_taxes = yes`) the shop
 * recomputes every order line's tax from the line's `tax_class` and its own
 * tax table — it never takes a rate from the request. A line sent without a
 * class is taxed at the PRODUCT's class (usually standard, 23%), so a 5% line
 * booked at 23% and the order total stopped matching what the buyer paid.
 *
 * This resolver reads the store's tax setup once per adapter instance and maps
 * `(country, rate)` → the class slug that produces exactly that rate, so the
 * order processor can pin `tax_class` on each line. With taxes OFF it answers
 * `null` and the create payload stays exactly as before.
 *
 * Matching is deliberately conservative — a wrong class books a wrong total,
 * which is worse than refusing the order (ADR-014):
 * - only rows that apply country-wide count; a class whose rows for that
 *   country are narrowed by state / postcode / city cannot be summarised as
 *   one rate, so it never matches that country;
 * - per priority, an exact-country row beats the wildcard (empty country)
 *   row, and rates of different priorities stack;
 * - a class holding compound rows never matches (its effective rate is not a
 *   plain sum);
 * - a class with NO row for the country taxes at 0%, which is how a stock
 *   "Zero rate" class works — it matches a 0% line;
 * - when several classes give the same rate, the standard class wins, then
 *   the store's own class order.
 *
 * Reads follow the product-master adapter's pattern: only a successful read is
 * cached, so a transport failure propagates (the order is not created) and the
 * next order retries the read.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 */
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import type {
  WooCommerceGeneralSetting,
  WooCommerceTaxRate,
} from '../product-master/woocommerce-product.types';
import type {
  WooCommerceTaxClassResponse,
  WooCommerceTaxClassTable,
} from './woocommerce-tax-class.types';

/** WooCommerce's slug for the standard class on the taxes endpoints. */
const STANDARD_CLASS_SLUG = 'standard';
/** The value a line item carries for the standard class. */
const STANDARD_LINE_TAX_CLASS = '';
/** WooCommerce caps `per_page` at 100. */
const WC_PAGE_SIZE = 100;
/** Defensive bound on the rate pages read per class. */
const WC_MAX_PAGES = 20;
/** Two rates within this many percentage points are the same rate. */
const RATE_EPSILON = 0.0001;

interface ClassRateTable {
  /** The line-item value for this class (`''` for standard). */
  lineTaxClass: string;
  /** Effective rate per upper-case country; `null` = not summarisable there. */
  byCountry: Map<string, number | null>;
  /** Effective rate for a country with no exact-country row. */
  wildcard: number | null;
}

export class WooCommerceTaxClassResolver {
  private table: Promise<WooCommerceTaxClassTable | null> | undefined;

  constructor(private readonly httpClient: IWooCommerceHttpClient) {}

  /**
   * The store's class table, or `null` when WooCommerce taxes are off. Read on
   * first use and cached for this instance; a failed read is not cached.
   */
  async load(): Promise<WooCommerceTaxClassTable | null> {
    if (this.table === undefined) {
      this.table = this.read().catch((error: unknown) => {
        this.table = undefined;
        throw error;
      });
    }
    return this.table;
  }

  private async read(): Promise<WooCommerceTaxClassTable | null> {
    const settings = await this.httpClient.get<WooCommerceGeneralSetting[]>(
      '/wp-json/wc/v3/settings/general',
    );
    const calcTaxes = (settings ?? []).find((row) => row.id === 'woocommerce_calc_taxes')?.value;
    if (calcTaxes !== 'yes') {
      return null;
    }

    const classes = await this.httpClient.get<WooCommerceTaxClassResponse[]>(
      '/wp-json/wc/v3/taxes/classes',
    );
    // The standard class is always first, whatever the endpoint lists.
    const slugs = [
      STANDARD_CLASS_SLUG,
      ...(classes ?? [])
        .map((entry) => entry.slug)
        .filter((slug): slug is string => typeof slug === 'string' && slug !== STANDARD_CLASS_SLUG),
    ];

    const tables: ClassRateTable[] = [];
    for (const slug of slugs) {
      const rows = await this.readRates(slug);
      tables.push(summariseClass(slug, rows));
    }
    return createTable(tables);
  }

  private async readRates(slug: string): Promise<WooCommerceTaxRate[]> {
    const rows: WooCommerceTaxRate[] = [];
    for (let page = 1; page <= WC_MAX_PAGES; page += 1) {
      const batch = await this.httpClient.get<WooCommerceTaxRate[]>('/wp-json/wc/v3/taxes', {
        class: slug,
        per_page: WC_PAGE_SIZE,
        page,
      });
      const items = batch ?? [];
      rows.push(...items);
      if (items.length < WC_PAGE_SIZE) break;
    }
    return rows;
  }
}

function isLocationRestricted(row: WooCommerceTaxRate): boolean {
  return Boolean(row.state?.trim()) || Boolean(row.postcode?.trim()) || Boolean(row.city?.trim());
}

/**
 * The effective rate of one set of rows that all apply to the same place:
 * one row per priority (WooCommerce applies the first match per priority),
 * summed across priorities. `null` when that is not a plain sum.
 */
function effectiveRate(rows: readonly WooCommerceTaxRate[]): number | null {
  const byPriority = new Map<number, WooCommerceTaxRate>();
  for (const row of [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const priority = row.priority ?? 1;
    if (!byPriority.has(priority)) byPriority.set(priority, row);
  }
  let total = 0;
  for (const row of byPriority.values()) {
    if (row.compound === true) return null;
    const rate = Number.parseFloat(row.rate ?? '');
    if (!Number.isFinite(rate)) return null;
    total += rate;
  }
  return total;
}

function summariseClass(slug: string, rows: readonly WooCommerceTaxRate[]): ClassRateTable {
  const exact = new Map<string, WooCommerceTaxRate[]>();
  const wildcard: WooCommerceTaxRate[] = [];
  const restrictedCountries = new Set<string>();
  let wildcardRestricted = false;

  for (const row of rows) {
    const country = (row.country ?? '').trim().toUpperCase();
    if (isLocationRestricted(row)) {
      if (country === '') wildcardRestricted = true;
      else restrictedCountries.add(country);
      continue;
    }
    if (country === '') {
      wildcard.push(row);
    } else {
      exact.set(country, [...(exact.get(country) ?? []), row]);
    }
  }

  // A location-restricted wildcard row may apply anywhere, so no country of
  // this class can be summarised as one rate.
  const wildcardRate = wildcardRestricted ? null : effectiveRate(wildcard);
  const byCountry = new Map<string, number | null>();
  for (const country of new Set([...exact.keys(), ...restrictedCountries])) {
    if (wildcardRestricted || restrictedCountries.has(country)) {
      byCountry.set(country, null);
      continue;
    }
    // Both the country's rows and the wildcard rows match an address in that
    // country; per priority the country's own row is the one that applies.
    const countryRows = exact.get(country) ?? [];
    const covered = new Set(countryRows.map((row) => row.priority ?? 1));
    const applicable = [
      ...countryRows,
      ...wildcard.filter((row) => !covered.has(row.priority ?? 1)),
    ];
    byCountry.set(country, effectiveRate(applicable));
  }

  return {
    lineTaxClass: slug === STANDARD_CLASS_SLUG ? STANDARD_LINE_TAX_CLASS : slug,
    byCountry,
    wildcard: wildcardRate,
  };
}

function createTable(classes: readonly ClassRateTable[]): WooCommerceTaxClassTable {
  return {
    resolve(country: string | undefined, ratePercent: number): string | null {
      const key = (country ?? '').trim().toUpperCase();
      for (const table of classes) {
        const rate = key !== '' && table.byCountry.has(key) ? table.byCountry.get(key) : table.wildcard;
        if (rate !== null && rate !== undefined && Math.abs(rate - ratePercent) < RATE_EPSILON) {
          return table.lineTaxClass;
        }
      }
      return null;
    },
  };
}
