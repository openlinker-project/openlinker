/**
 * Order note timeline schema (#3531)
 *
 * Parsed, never cast — the `return-timeline.schema.ts` precedent: a contract
 * break surfaces as a named failure, not as `undefined` rendered where an
 * Activity entry belongs. `kind` is a plain STRING on purpose, so a kind this
 * build predates still reaches the operator (the mapper renders it rather
 * than dropping it). The optional fields are `.nullish()` (lessons: the wire
 * may omit them as well as send `null`). `occurredAt` is required — a
 * dateless entry has no position on a chronological timeline.
 *
 * @module apps/web/src/features/orders/api
 */
import { z } from 'zod/v4';
import type { OrderNoteTimelineEntry } from './orders.types';

export class OrderNoteTimelineUnreadableError extends Error {
  constructor() {
    super('The note activity for this order could not be read.');
    this.name = 'OrderNoteTimelineUnreadableError';
  }
}

const entrySchema = z.object({
  noteId: z.string(),
  kind: z.string(),
  occurredAt: z.string(),
  actorUsername: z.string(),
  body: z.string().nullish(),
  showToPacker: z.boolean().nullish(),
});

const responseSchema = z.array(entrySchema);

export function parseOrderNoteTimeline(raw: unknown): OrderNoteTimelineEntry[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrderNoteTimelineUnreadableError();
  }
  return parsed.data.map((entry) => ({
    noteId: entry.noteId,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    actorUsername: entry.actorUsername,
    body: entry.body ?? null,
    showToPacker: entry.showToPacker ?? null,
  }));
}
