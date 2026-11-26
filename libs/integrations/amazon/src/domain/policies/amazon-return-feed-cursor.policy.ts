/**
 * Amazon Return Feed Cursor Policy (#4184)
 *
 * Returns come from a report Amazon builds asynchronously, so the return feed
 * cursor records which step of a report cycle the connection is at. Core
 * treats it as an opaque string; only this file reads it.
 *
 *   - `idle`: the last report covered returns requested up to `until`.
 *   - `pending`: report `reportId` was requested for a window ending at `until`
 *     and Amazon is building it.
 *   - `reading`: the report document is ready; `offset` returns of it were
 *     already handed to core.
 *
 * An unreadable cursor starts a fresh bootstrap rather than wedging the feed:
 * re-reading returns is safe because return ingestion is idempotent.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */

export type AmazonReturnFeedCursor =
  | { readonly step: 'idle'; readonly until: string }
  | { readonly step: 'pending'; readonly reportId: string; readonly until: string }
  | { readonly step: 'reading'; readonly reportDocumentId: string; readonly until: string; readonly offset: number };

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a new connection looks for returns. */
export const AMAZON_RETURN_FEED_BOOTSTRAP_DAYS = 30;

export function decodeAmazonReturnFeedCursor(raw: string | null, now: Date): AmazonReturnFeedCursor {
  const bootstrap: AmazonReturnFeedCursor = {
    step: 'idle',
    until: new Date(now.getTime() - AMAZON_RETURN_FEED_BOOTSTRAP_DAYS * DAY_MS).toISOString(),
  };
  if (raw === null || raw.length === 0) {
    return bootstrap;
  }
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return bootstrap;
    value = parsed as Record<string, unknown>;
  } catch {
    return bootstrap;
  }
  if (typeof value.until !== 'string' || Number.isNaN(Date.parse(value.until))) {
    return bootstrap;
  }
  if (value.step === 'pending' && typeof value.reportId === 'string' && value.reportId.length > 0) {
    return { step: 'pending', reportId: value.reportId, until: value.until };
  }
  if (
    value.step === 'reading' &&
    typeof value.reportDocumentId === 'string' &&
    value.reportDocumentId.length > 0 &&
    typeof value.offset === 'number' &&
    Number.isInteger(value.offset) &&
    value.offset >= 0
  ) {
    return { step: 'reading', reportDocumentId: value.reportDocumentId, until: value.until, offset: value.offset };
  }
  return { step: 'idle', until: value.until };
}

export function encodeAmazonReturnFeedCursor(cursor: AmazonReturnFeedCursor): string {
  return JSON.stringify(cursor);
}
