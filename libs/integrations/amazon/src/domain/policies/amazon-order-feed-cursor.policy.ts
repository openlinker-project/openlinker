/**
 * Amazon Order Feed Cursor Policy
 *
 * The order feed reads `searchOrders` by `lastUpdatedAfter`, so the cursor is a
 * WATERMARK plus, mid-way through a multi-page window, Amazon's pagination
 * token. Core treats it as an opaque string; only this file reads it.
 *
 * Rules:
 *   - No cursor: start `AMAZON_ORDER_FEED_BOOTSTRAP_DAYS` back, so a new
 *     connection picks up the orders still open on Amazon without replaying
 *     the whole account history.
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
 *     bootstrap point (never forward) and any pagination token dropped, so the
 *     new marketplace's open orders are read like a new connection's. A cursor
 *     written before this rule carries no list and is taken to cover the
 *     connection's current marketplaces.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */

export const AMAZON_ORDER_FEED_BOOTSTRAP_DAYS = 7;
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

const DAY_MS = 24 * 60 * 60 * 1000;

export function decodeAmazonOrderFeedCursor(raw: string | null, now: Date): AmazonOrderFeedCursor {
  const bootstrap: AmazonOrderFeedCursor = {
    since: new Date(now.getTime() - AMAZON_ORDER_FEED_BOOTSTRAP_DAYS * DAY_MS).toISOString(),
  };
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
 * bootstrap point and drops the pagination token (it was issued for the old
 * marketplace list). Re-reading the other marketplaces' recent orders is
 * safe: order sync is idempotent. A removed marketplace changes nothing but
 * the recorded list.
 */
export function scopeAmazonOrderFeedCursor(
  cursor: AmazonOrderFeedCursor,
  marketplaceIds: readonly string[],
  now: Date,
): AmazonOrderFeedCursor {
  const covered = cursor.marketplaceIds;
  const added = covered === undefined ? [] : marketplaceIds.filter((id) => !covered.includes(id));
  if (added.length === 0) {
    return { ...cursor, marketplaceIds: [...marketplaceIds] };
  }
  const bootstrap = now.getTime() - AMAZON_ORDER_FEED_BOOTSTRAP_DAYS * DAY_MS;
  const since = Math.min(Date.parse(cursor.since), bootstrap);
  return { since: new Date(since).toISOString(), marketplaceIds: [...marketplaceIds] };
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
