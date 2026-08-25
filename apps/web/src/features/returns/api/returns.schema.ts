/**
 * Returns List Schema
 *
 * Zod parse of the `GET /returns` projection (#2334) into the typed view model
 * the list renders (#2335).
 *
 * Two decisions this file owns.
 *
 * **`.nullish()`, never `.optional()` (#939).** OpenLinker serialises an absent
 * optional field as JSON `null`, and a bare `.optional()` rejects `null` — the
 * failure that blanked a whole address section from one empty field. Every
 * nullable field here is `.nullish()` so both shapes survive.
 *
 * **The parse is per-row and non-fatal.** A single malformed row drops itself
 * and is counted, rather than failing the page — the `order-snapshot.schema.ts`
 * precedent. The row counts (`total`, `counts`) come from the server and are
 * left untouched by a drop, so the pagination arithmetic never silently shifts
 * to describe a different set than the operator is paging through; the page
 * reports the drop instead of quietly showing fewer rows than it claims.
 *
 * @module apps/web/src/features/returns/api
 */
import { z } from 'zod/v4';
import {
  RETURN_BUCKET_VALUES,
  RETURN_ORIGIN_VALUES,
  type ReturnBucketCounts,
  type ReturnListItem,
} from './returns.types';

/**
 * `bucket` and `origin` are closed unions the backend validates before it
 * writes them, so a value outside the union is a genuine contract break rather
 * than data variance — the row drops and is reported, which is the only honest
 * rendering of "this build does not understand this row".
 */
const returnListItemSchema = z.object({
  id: z.string(),
  sourceConnectionId: z.string(),
  externalReturnId: z.string().nullish(),
  internalOrderId: z.string().nullish(),
  externalOrderId: z.string().nullish(),
  origin: z.enum(RETURN_ORIGIN_VALUES),
  bucket: z.enum(RETURN_BUCKET_VALUES),
  rawStatus: z.string().nullish(),
  openedAt: z.string().nullish(),
  authorizedAt: z.string().nullish(),
  declinedAt: z.string().nullish(),
  closedAt: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const returnBucketCountsSchema = z.object({
  total: z.number(),
  orphan: z.number(),
  attributed: z.number(),
});

export interface ParsedReturnList {
  items: ReturnListItem[];
  /** Rows the server sent that this build could not read. Reported, never hidden. */
  droppedCount: number;
  /**
   * Bucket-APPLIED count — what pagination reads. Falls back to the number of
   * rows actually parsed when the server's own field is unreadable, so a
   * broken envelope degrades to "one page" rather than to an infinite Next.
   */
  total: number;
  /**
   * The chip partition, or `null` when the server did not report readable
   * counts.
   *
   * Deliberately NOT defaulted to a synthesised partition. Inventing
   * `{ total: items.length, orphan: 0, attributed: items.length }` would put two
   * fabricated claims straight onto the chips — that every row on this page is
   * matched to an order, and that the page IS the whole scope — as
   * authoritative numbers. Same rule as
   * {@link parseReturnIngestionAvailability}: an unreadable response is not
   * evidence for a positive claim. The caller drops the numbers instead.
   */
  counts: ReturnBucketCounts | null;
  /**
   * The paging the server ACTUALLY applied, which is not always what was asked
   * for — the controller fills its own defaults when a param is absent. Null
   * when the server did not report it, so a caller can fall back to its own
   * request rather than to a fabricated zero.
   */
  limit: number | null;
  offset: number | null;
}

/**
 * Normalise the schema's `T | null | undefined` back onto the view model's
 * `T | null`. `undefined` and `null` mean the same thing here — the field was
 * not reported — and collapsing them at the boundary keeps every consumer from
 * having to test for both.
 */
function orNull<T>(value: T | null | undefined): T | null {
  return value === undefined || value === null ? null : value;
}

/**
 * Parse one page of the list envelope.
 *
 * Never throws: a caller renders an unreadable page as an empty list with a
 * reported drop count, which is strictly more informative than an error state
 * that says nothing about how much was lost.
 */
export function parseReturnList(raw: unknown): ParsedReturnList {
  const envelope = z
    .object({
      items: z.array(z.unknown()).nullish(),
      total: z.number().nullish(),
      limit: z.number().nullish(),
      offset: z.number().nullish(),
      counts: returnBucketCountsSchema.nullish(),
    })
    .safeParse(raw);

  if (!envelope.success) {
    return { items: [], droppedCount: 0, total: 0, counts: null, limit: null, offset: null };
  }

  const rawItems = envelope.data.items ?? [];
  const items: ReturnListItem[] = [];
  let droppedCount = 0;

  for (const rawItem of rawItems) {
    const parsed = returnListItemSchema.safeParse(rawItem);
    if (!parsed.success) {
      droppedCount += 1;
      continue;
    }
    items.push({
      id: parsed.data.id,
      sourceConnectionId: parsed.data.sourceConnectionId,
      externalReturnId: orNull(parsed.data.externalReturnId),
      internalOrderId: orNull(parsed.data.internalOrderId),
      externalOrderId: orNull(parsed.data.externalOrderId),
      origin: parsed.data.origin,
      bucket: parsed.data.bucket,
      rawStatus: orNull(parsed.data.rawStatus),
      openedAt: orNull(parsed.data.openedAt),
      authorizedAt: orNull(parsed.data.authorizedAt),
      declinedAt: orNull(parsed.data.declinedAt),
      closedAt: orNull(parsed.data.closedAt),
      createdAt: parsed.data.createdAt,
      updatedAt: parsed.data.updatedAt,
    });
  }

  return {
    items,
    droppedCount,
    total: envelope.data.total ?? items.length,
    counts: envelope.data.counts ?? null,
    limit: envelope.data.limit ?? null,
    offset: envelope.data.offset ?? null,
  };
}

const ingestionAvailabilitySchema = z.object({
  configured: z.boolean(),
  connectionIds: z.array(z.string()).nullish(),
});

/**
 * Parse the ingestion-availability fact.
 *
 * An unreadable response returns `null` rather than `configured: false`,
 * because `false` is a positive claim about the operator's configuration and a
 * parse failure is not evidence for it. The caller renders the neutral empty
 * state on `null`.
 */
export function parseReturnIngestionAvailability(
  raw: unknown,
): { configured: boolean; connectionIds: string[] } | null {
  const parsed = ingestionAvailabilitySchema.safeParse(raw);
  if (!parsed.success) return null;
  return { configured: parsed.data.configured, connectionIds: parsed.data.connectionIds ?? [] };
}
