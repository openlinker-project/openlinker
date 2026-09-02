/**
 * Order return-activity schema (#2383)
 *
 * Parsed, never cast — a contract break must surface as a named failure rather
 * than as `undefined` rendered where an event belongs.
 *
 * `source` and `kind` are read as plain STRINGS, deliberately, the same rule
 * `return-proposal.schema.ts` states: a value this build predates must still
 * reach the operator rather than being blanked. The mapper renders an
 * unrecognised kind rather than dropping it.
 *
 * `occurredAt` is REQUIRED and non-nullable, matching the backend contract —
 * every source supplies an instant, and a dateless entry on a timeline would be
 * wrong rather than merely degraded.
 *
 * @module apps/web/src/features/returns/api
 */
import { z } from 'zod/v4';
import type { ReturnTimelineEntry } from './returns.types';

export class ReturnTimelineUnreadableError extends Error {
  constructor() {
    super('The return activity for this order could not be read.');
    this.name = 'ReturnTimelineUnreadableError';
  }
}

const entrySchema = z.object({
  id: z.string(),
  source: z.string(),
  kind: z.string(),
  occurredAt: z.string(),
  returnId: z.string(),
  externalReturnId: z.string().nullish(),
  returnOrigin: z.string(),
  sourceConnectionName: z.string().nullish(),
  actorUserId: z.string().nullish(),
  quantity: z.number().nullish(),
  restockState: z.string().nullish(),
  disposition: z.string().nullish(),
  refundExecutedBy: z.string().nullish(),
  amount: z.string().nullish(),
  currency: z.string().nullish(),
});

const responseSchema = z.object({ entries: z.array(entrySchema) });

export function parseReturnTimeline(raw: unknown): ReturnTimelineEntry[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReturnTimelineUnreadableError();
  }

  return parsed.data.entries.map((entry) => ({
    id: entry.id,
    source: entry.source,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    returnId: entry.returnId,
    externalReturnId: entry.externalReturnId ?? null,
    returnOrigin: entry.returnOrigin,
    sourceConnectionName: entry.sourceConnectionName ?? null,
    actorUserId: entry.actorUserId ?? null,
    quantity: entry.quantity ?? null,
    restockState: entry.restockState ?? null,
    disposition: entry.disposition ?? null,
    refundExecutedBy: entry.refundExecutedBy ?? null,
    amount: entry.amount ?? null,
    currency: entry.currency ?? null,
  }));
}
