/**
 * Shoper Option Table Provider
 *
 * A stock's `options` carries ids only (`{ "10": "68" }`); the option's name and
 * the value's text live in `/options/:id` and `/option-values`. This reads each
 * option once per provider instance - the option plus ALL of its values, since a
 * colour option holds dozens - so a sweep over a catalogue does not repeat the
 * reads for every variant.
 *
 * Memoised per option id as a PROMISE (concurrent callers share one request); a
 * transport failure is dropped from the memo so the next call retries. An answer
 * that is `null` (unknown option, or a read that cannot be trusted) is memoised:
 * it is the shop's answer, not a fault.
 *
 * @module libs/integrations/shoper/src/infrastructure/shop-context
 */
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';
import type { ShoperOption, ShoperOptionValue } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../http/shoper-pagination';

/** One option and every value it can take, keyed by `ovalue_id`. */
export interface ShoperOptionEntry {
  readonly option: ShoperOption;
  readonly values: ReadonlyMap<string, ShoperOptionValue>;
}

export class ShoperOptionTableProvider {
  private readonly logger = new Logger(ShoperOptionTableProvider.name);
  private readonly pending = new Map<string, Promise<ShoperOptionEntry | null>>();

  constructor(private readonly client: ShoperHttpClient) {}

  /** The option, or `null` when it does not exist or its read cannot be trusted. */
  get(optionId: string): Promise<ShoperOptionEntry | null> {
    let entry = this.pending.get(optionId);
    if (entry === undefined) {
      entry = this.load(optionId).catch((error: unknown) => {
        this.pending.delete(optionId);
        throw error;
      });
      this.pending.set(optionId, entry);
    }
    return entry;
  }

  private async load(optionId: string): Promise<ShoperOptionEntry | null> {
    let option: ShoperOption;
    try {
      option = (await this.client.get<ShoperOption>(`/options/${optionId}`)).data;
    } catch (error) {
      if (error instanceof ShoperApiError && error.isResourceNotFound()) {
        return null;
      }
      throw error;
    }
    if (String(option.option_id) !== optionId) {
      this.logger.warn(`Shoper returned option ${String(option.option_id)} for ${optionId}; ignored`);
      return null;
    }

    const values = new Map<string, ShoperOptionValue>();
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<ShoperOptionValue>(this.client, '/option-values', {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        // Explicit direction: a bare `order=<field>` sorts DESCENDING on Shoper.
        query: { 'filters[option_id]': optionId, order: 'ovalue_id ASC' },
      });
      for (const row of result.items) {
        // A row of ANOTHER option proves the filter was not honoured: the page is
        // the first of the whole table, so nothing in it can be trusted.
        if (String(row.option_id) !== optionId) {
          this.logger.warn(
            `Shoper returned values of other options while reading option ${optionId}; ` +
              'the option-values filter was not honoured, so its values are not used',
          );
          return null;
        }
        values.set(String(row.ovalue_id), row);
      }
      if (page >= result.pages) {
        return { option, values };
      }
    }
  }
}
