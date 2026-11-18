/**
 * Amazon Connection-Config Contribution (#4186)
 *
 * The non-render half of the Amazon edit section: the marketplaces OpenLinker
 * reads orders from and writes offers to, the merchant token the listings API
 * needs, the SQS queue Amazon delivers order notifications to, and the rates
 * the account's product tax codes carry (#4182). Region and environment are
 * fixed at create and only shown: another region is another seller account
 * with its own refresh token, so the API refuses the change and another
 * region is a new connection.
 *
 * A marketplace added here is picked up by the order feed, which rewinds its
 * watermark for it (`scopeAmazonOrderFeedCursor`).
 *
 * Each rule is no stricter than `parseAmazonConfig` on the API, which refuses
 * the same values on save.
 *
 * CLEARING WRITES `null`, NOT A DELETED KEY: the host submit merges
 * `{ ...fresh.config, ...input.config }` shallowly, so a deleted top-level key
 * would come back from the refetch. The API reads `null` like absent.
 *
 * @module plugins/amazon
 */
import { z } from 'zod';
import { SELLER_ID, SQS_QUEUE_URL, findMarketplace, isSingleMarketplaceRegion } from '../../features/amazon';
import type { ConnectionConfigContribution } from '../../shared/plugins';
import { readOptionalConfigString } from '../../shared/plugins';
import { getAmazonMessages } from './messages';

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /** `config.marketplaceIds`, comma-joined. */
    amazonMarketplaceIds?: string;
    /** `config.sellerId`, the merchant token. */
    amazonSellerId?: string;
    /** `config.notificationQueueUrl`. */
    amazonNotificationQueueUrl?: string;
    /** `config.taxCodeRates`, one `CODE=rate` per line (#4182). */
    amazonTaxCodeRates?: string;
  }
}

/** Mirrors `TAX_RATE_CODE_PATTERN` in `amazon-config.policy.ts`. */
const TAX_RATE = /^(\d{1,2}(\.\d{1,2})?|zw|np|oo)$/;

export interface AmazonTaxCodeRow {
  readonly code: string;
  readonly rate: string;
}

/**
 * The tax-code rows the field holds, one `CODE=rate` per line. A row being
 * typed (code or rate still empty) is kept, so the editor can show it.
 */
export function parseTaxCodeRows(value: string): AmazonTaxCodeRow[] {
  return value
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const cut = line.indexOf('=');
      return cut === -1
        ? { code: line.trim(), rate: '' }
        : { code: line.slice(0, cut).trim(), rate: line.slice(cut + 1).trim() };
    });
}

export function formatTaxCodeRows(rows: readonly AmazonTaxCodeRow[]): string {
  return rows.map((row) => `${row.code}=${row.rate}`).join('\n');
}

function isBlankRow(row: AmazonTaxCodeRow): boolean {
  return row.code === '' && row.rate === '';
}

function isValidTaxCodeRow(row: AmazonTaxCodeRow): boolean {
  return isBlankRow(row) || (row.code !== '' && TAX_RATE.test(row.rate.toLowerCase()));
}

export function splitMarketplaceIds(value: string): string[] {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** More than one marketplace where a region has a seller account per marketplace. */
function exceedsSingleMarketplaceRegion(ids: readonly string[]): boolean {
  return (
    ids.length > 1 &&
    ids.some((id) => {
      const known = findMarketplace(id);
      return known !== undefined && isSingleMarketplaceRegion(known.region);
    })
  );
}

function optionalPattern(pattern: RegExp, message: () => string): z.ZodTypeAny {
  return z
    .string()
    // The message is looked up when a value is validated, so it follows the
    // active language instead of freezing at module load.
    .refine((value) => value.trim() === '' || pattern.test(value.trim()), { error: message })
    .optional();
}

// Annotated so TS keeps the excess-property check live (the KSeF precedent).
const amazonSchemaShape: ConnectionConfigContribution['schemaShape'] = {
  amazonMarketplaceIds: z
    .string()
    .refine((value) => splitMarketplaceIds(value).length > 0, {
      error: () => getAmazonMessages().setup.errors.marketplaceRequired,
    })
    .refine((value) => !exceedsSingleMarketplaceRegion(splitMarketplaceIds(value)), {
      error: () => getAmazonMessages().setup.errors.marketplaceSingle,
    })
    .optional(),
  amazonSellerId: optionalPattern(SELLER_ID, () => getAmazonMessages().setup.errors.sellerIdInvalid),
  amazonNotificationQueueUrl: optionalPattern(
    SQS_QUEUE_URL,
    () => getAmazonMessages().setup.errors.queueUrlInvalid,
  ),
  amazonTaxCodeRates: z
    .string()
    .refine((value) => parseTaxCodeRows(value).every(isValidTaxCodeRow), {
      error: () => getAmazonMessages().edit.taxCodes.invalid,
    })
    .optional(),
};

function readAmazonConfig(config: Record<string, unknown>): Record<string, string> {
  const ids = Array.isArray(config.marketplaceIds)
    ? config.marketplaceIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    amazonMarketplaceIds: ids.join(','),
    amazonSellerId: typeof config.sellerId === 'string' ? config.sellerId : '',
    amazonNotificationQueueUrl:
      typeof config.notificationQueueUrl === 'string' ? config.notificationQueueUrl : '',
    amazonTaxCodeRates: formatTaxCodeRows(readTaxCodeRates(config.taxCodeRates)),
  };
}

function readTaxCodeRates(value: unknown): AmazonTaxCodeRow[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([code, rate]) => ({ code, rate }));
}

function applyAmazonConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };

  const marketplaces = readOptionalConfigString(patch, 'amazonMarketplaceIds');
  if (marketplaces !== undefined) {
    next.marketplaceIds = splitMarketplaceIds(marketplaces);
  }

  const sellerId = readOptionalConfigString(patch, 'amazonSellerId');
  if (sellerId !== undefined) {
    const text = sellerId.trim().toUpperCase();
    next.sellerId = text === '' ? null : text;
  }

  const queue = readOptionalConfigString(patch, 'amazonNotificationQueueUrl');
  if (queue !== undefined) {
    const text = queue.trim();
    next.notificationQueueUrl = text === '' ? null : text;
  }

  const taxCodes = readOptionalConfigString(patch, 'amazonTaxCodeRates');
  if (taxCodes !== undefined) {
    const rows = parseTaxCodeRows(taxCodes).filter((row) => !isBlankRow(row));
    next.taxCodeRates =
      rows.length === 0
        ? null
        : Object.fromEntries(rows.map((row) => [row.code.toUpperCase(), row.rate.toLowerCase()]));
  }

  return next;
}

export const amazonConnectionConfig: ConnectionConfigContribution = {
  schemaShape: amazonSchemaShape,
  readConfigToForm: readAmazonConfig,
  applyToConfig: applyAmazonConfig,
};
