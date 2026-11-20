/**
 * Amazon Order Feed Cursor Policy
 *
 * The order feed reads `searchOrders` by `lastUpdatedAfter`, so the cursor is a
 * WATERMARK plus, mid-way through a multi-page window, Amazon's pagination
 * token. Core treats it as an opaque string; only this file reads it.
 *
 * Rules:
 *   - No cursor: start at `AMAZON_ORDER_FEED_HISTORY_START`, so a new
 *     connection reads the account's whole order history, as the other order
 *     sources do. Amazon sets no lower bound on `lastUpdatedAfter`; the
 *     history arrives in pages at the `searchOrders` quota.
 *   - A pagination token expires 24 h after it was issued. A cursor holding an
 *     older one restarts the window from its watermark instead of sending a
 *     token Amazon will refuse; re-reading is safe because order sync is
 *     idempotent.
 *   - The next watermark is Amazon's own `lastUpdatedBefore` for the window,
 *     moved back by `AMAZON_ORDER_FEED_OVERLAP_MS`, so an order updated at the
 *     edge of a window is read again rather than missed.
 *   - An unreadable cursor starts a fresh bootstrap rather than wedging the feed.
 *   - The cursor records the marketplaces its watermark covers. When the
 *     connection gains a marketplace, the watermark is moved back to the
 *     history start and any pagination token dropped, so the new
 *     marketplace's orders are read like a new connection's. A cursor
 *     written before this rule carries no list and is taken to cover the
 *     connection's current marketplaces.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */

/** Earlier than any order the Selling Partner API can return. */
export const AMAZON_ORDER_FEED_HISTORY_START = '2000-01-01T00:00:00.000Z';
export const AMAZON_ORDER_FEED_OVERLAP_MS = 2 * 60 * 1000;
export const AMAZON_PAGINATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface AmazonOrderFeedCursor {
  /** `lastUpdatedAfter` of the current window (ISO 8601). */
  readonly since: string;
  /** Present only while a window has more pages. */
  readonly paginationToken?: string;
  /** When the token was issued (ISO 8601); expires after 24 h. */
  readonly tokenIssuedAt?: string;
  /** Marketplaces the watermark covers; absent on a cursor that predates the field. */
  readonly marketplaceIds?: readonly string[];
}

export function decodeAmazonOrderFeedCursor(raw: string | null, now: Date): AmazonOrderFeedCursor {
  const bootstrap: AmazonOrderFeedCursor = { since: AMAZON_ORDER_FEED_HISTORY_START };
  if (raw === null || raw.length === 0) {
    return bootstrap;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return bootstrap;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return bootstrap;
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.since !== 'string' || Number.isNaN(Date.parse(value.since))) {
    return bootstrap;
  }
  const token = typeof value.paginationToken === 'string' ? value.paginationToken : undefined;
  const issuedAt = typeof value.tokenIssuedAt === 'string' ? Date.parse(value.tokenIssuedAt) : Number.NaN;
  const tokenUsable =
    token !== undefined && !Number.isNaN(issuedAt) && now.getTime() - issuedAt < AMAZON_PAGINATION_TOKEN_TTL_MS;
  const marketplaceIds =
    Array.isArray(value.marketplaceIds) && value.marketplaceIds.every((id) => typeof id === 'string')
      ? { marketplaceIds: value.marketplaceIds as string[] }
      : {};
  return tokenUsable
    ? { since: value.since, paginationToken: token, tokenIssuedAt: value.tokenIssuedAt as string, ...marketplaceIds }
    : { since: value.since, ...marketplaceIds };
}

/**
 * The cursor for the connection's CURRENT marketplaces.
 *
 * A marketplace the cursor does not cover moves the watermark back to the
 * history start and drops the pagination token (it was issued for the old
 * marketplace list). Re-reading the other marketplaces' orders is safe: order
 * sync is idempotent. A removed marketplace changes nothing but
 * the recorded list.
 */
export function scopeAmazonOrderFeedCursor(
  cursor: AmazonOrderFeedCursor,
  marketplaceIds: readonly string[],
): AmazonOrderFeedCursor {
  const covered = cursor.marketplaceIds;
  const added = covered === undefined ? [] : marketplaceIds.filter((id) => !covered.includes(id));
  if (added.length === 0) {
    return { ...cursor, marketplaceIds: [...marketplaceIds] };
  }
  return { since: AMAZON_ORDER_FEED_HISTORY_START, marketplaceIds: [...marketplaceIds] };
}

export function encodeAmazonOrderFeedCursor(cursor: AmazonOrderFeedCursor): string {
  return JSON.stringify(cursor);
}

/**
 * Where the feed goes after a page.
 *
 * `windowEnd` is Amazon's `lastUpdatedBefore`; when Amazon names none, the
 * latest `lastUpdatedTime` on the page is used, and with neither the watermark
 * stays where it was.
 */
export function nextAmazonOrderFeedCursor(input: {
  readonly current: AmazonOrderFeedCursor;
  readonly nextToken: string | undefined;
  readonly windowEnd: string | undefined;
  readonly latestUpdatedOnPage: string | undefined;
  readonly now: Date;
}): AmazonOrderFeedCursor {
  const scope = input.current.marketplaceIds ? { marketplaceIds: input.current.marketplaceIds } : {};
  if (input.nextToken !== undefined && input.nextToken.length > 0) {
    return {
      since: input.current.since,
      paginationToken: input.nextToken,
      tokenIssuedAt: input.now.toISOString(),
      ...scope,
    };
  }
  const end = input.windowEnd ?? input.latestUpdatedOnPage;
  if (end === undefined || Number.isNaN(Date.parse(end))) {
    return { since: input.current.since, ...scope };
  }
  const moved = Date.parse(end) - AMAZON_ORDER_FEED_OVERLAP_MS;
  // Never move the watermark backwards past where this window started.
  const since = Math.max(moved, Date.parse(input.current.since));
  return { since: new Date(since).toISOString(), ...scope };
}
