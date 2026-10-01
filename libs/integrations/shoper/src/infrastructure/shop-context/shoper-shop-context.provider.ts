/**
 * Shoper Shop Context Provider
 *
 * Reads the few facts about a shop the mapper needs that are not on the product
 * payload - default language, default currency and weight unit - from
 * `GET /application-config`, once per provider instance.
 *
 * The in-flight request is memoised as a PROMISE, so concurrent callers share
 * one round-trip, and a FAILURE is dropped from the memo so the next call
 * retries instead of replaying a rejected promise for the adapter's lifetime.
 *
 * @module libs/integrations/shoper/src/infrastructure/shop-context
 */
import { SHOPER_CONNECTION_TEST_PATH } from '../../shoper.constants';
import type { ShoperApplicationConfig } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import type { ShoperMapContext } from '../mappers/shoper-product.mapper';

/** Used only when the shop omits `locale_default_weight`; kilograms is Shoper's default unit. */
const FALLBACK_WEIGHT_UNIT = 'KILOGRAM';

export class ShoperShopContextProvider {
  private pending: Promise<ShoperMapContext> | null = null;

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly host: string,
  ) {}

  get(): Promise<ShoperMapContext> {
    if (this.pending === null) {
      this.pending = this.load().catch((error: unknown) => {
        this.pending = null;
        throw error;
      });
    }
    return this.pending;
  }

  private async load(): Promise<ShoperMapContext> {
    const { data } = await this.client.get<Partial<ShoperApplicationConfig>>(
      SHOPER_CONNECTION_TEST_PATH,
    );
    return {
      host: this.host,
      language: data.default_language_name ?? '',
      currency: data.default_currency_name ?? null,
      weightUnit: data.locale_default_weight ?? FALLBACK_WEIGHT_UNIT,
    };
  }
}
