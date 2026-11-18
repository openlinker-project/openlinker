/**
 * Amazon Connection-Config Contribution (#4186)
 *
 * The non-render half of the Amazon edit section: the marketplaces OpenLinker
 * reads orders from and writes offers to, the merchant token the listings API
 * needs, and the SQS queue Amazon delivers order notifications to. Region and
 * environment is fixed at create and only shown. The region can be changed:
 * the LWA credentials work in every region, and the marketplaces of the old
 * region are dropped with it (the API refuses them on another region's host).
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
import { SQS_QUEUE_URL, isAmazonRegion } from '../../features/amazon';
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
    /** `config.region`: changing it moves the connection to another Amazon server. */
    amazonRegion?: string;
  }
}

const SELLER_ID = /^[A-Z0-9]{8,20}$/;

export function splitMarketplaceIds(value: string): string[] {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
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
    .optional(),
  amazonRegion: z.string().optional(),
  amazonSellerId: optionalPattern(SELLER_ID, () => getAmazonMessages().setup.errors.sellerIdInvalid),
  amazonNotificationQueueUrl: optionalPattern(
    SQS_QUEUE_URL,
    () => getAmazonMessages().setup.errors.queueUrlInvalid,
  ),
};

function readAmazonConfig(config: Record<string, unknown>): Record<string, string> {
  const ids = Array.isArray(config.marketplaceIds)
    ? config.marketplaceIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    amazonMarketplaceIds: ids.join(','),
    amazonRegion: typeof config.region === 'string' ? config.region : 'eu',
    amazonSellerId: typeof config.sellerId === 'string' ? config.sellerId : '',
    amazonNotificationQueueUrl:
      typeof config.notificationQueueUrl === 'string' ? config.notificationQueueUrl : '',
  };
}

function applyAmazonConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };

  const region = readOptionalConfigString(patch, 'amazonRegion');
  if (region !== undefined && isAmazonRegion(region)) {
    next.region = region;
  }

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

  return next;
}

export const amazonConnectionConfig: ConnectionConfigContribution = {
  schemaShape: amazonSchemaShape,
  readConfigToForm: readAmazonConfig,
  applyToConfig: applyAmazonConfig,
};
