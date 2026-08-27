/**
 * Return Custody Write Schemas
 *
 * Parsers for the three per-line custody writes (#2380) — receive, dispose and
 * the not-returned write-off.
 *
 * The feature's rule holds here as everywhere: a response is PARSED, never
 * cast, so a contract break surfaces as a named failure instead of an
 * `undefined` rendered into a counter cell an operator then trusts.
 *
 * Two shapes are deliberately lenient. `custodyState` / `moneyState` /
 * `disposition` are read as plain strings, because a state this build predates
 * must still round-trip — the write HAPPENED, and refusing to read its result
 * would report a failure for a change that landed. And `restockBlocked` is read
 * off a 2xx body: it is never an error, it is the disposition succeeding while
 * the stock write did not.
 *
 * @module apps/web/src/features/returns/api
 */
import { z } from 'zod/v4';
import type {
  DisposeReturnLineResult,
  MarkReturnLineNotReturnedResult,
  ReceiveReturnLineResult,
  ReturnLineCounters,
} from './returns.types';

/** A custody write's response could not be read. */
export class ReturnCustodyResultUnreadableError extends Error {
  constructor() {
    super('The server accepted the change but sent a result this build could not read.');
    this.name = 'ReturnCustodyResultUnreadableError';
  }
}

const lineCountersSchema = z.object({
  id: z.string(),
  quantityAdvised: z.number(),
  quantityReceived: z.number(),
  quantityRestocked: z.number(),
  quantityScrapped: z.number(),
  custodyState: z.string(),
  moneyState: z.string(),
  disposition: z.string().nullish(),
  receivedAt: z.string().nullish(),
  disposedAt: z.string().nullish(),
});

const restockBlockedSchema = z.object({
  eventId: z.string(),
  quantity: z.number(),
  sku: z.string().nullish(),
  reason: z.string(),
  detail: z.string().nullish(),
  connectionId: z.string().nullish(),
  connectionName: z.string().nullish(),
  state: z.string(),
});

const receiveResultSchema = z.object({
  line: lineCountersSchema,
  eventId: z.string(),
});

const disposeResultSchema = z.object({
  line: lineCountersSchema,
  eventId: z.string(),
  restockBlocked: restockBlockedSchema.nullish(),
});

function orNull<T>(value: T | null | undefined): T | null {
  return value === undefined || value === null ? null : value;
}

function toCounters(raw: z.infer<typeof lineCountersSchema>): ReturnLineCounters {
  return {
    id: raw.id,
    quantityAdvised: raw.quantityAdvised,
    quantityReceived: raw.quantityReceived,
    quantityRestocked: raw.quantityRestocked,
    quantityScrapped: raw.quantityScrapped,
    custodyState: raw.custodyState,
    moneyState: raw.moneyState,
    disposition: orNull(raw.disposition),
    receivedAt: orNull(raw.receivedAt),
    disposedAt: orNull(raw.disposedAt),
  };
}

export function parseReceiveReturnLineResult(raw: unknown): ReceiveReturnLineResult {
  const parsed = receiveResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReturnCustodyResultUnreadableError();
  }
  return { line: toCounters(parsed.data.line), eventId: parsed.data.eventId };
}

export function parseMarkNotReturnedResult(raw: unknown): MarkReturnLineNotReturnedResult {
  const parsed = receiveResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReturnCustodyResultUnreadableError();
  }
  return { line: toCounters(parsed.data.line), eventId: parsed.data.eventId };
}

export function parseDisposeReturnLineResult(raw: unknown): DisposeReturnLineResult {
  const parsed = disposeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReturnCustodyResultUnreadableError();
  }

  const blocked = parsed.data.restockBlocked;

  return {
    line: toCounters(parsed.data.line),
    eventId: parsed.data.eventId,
    // Absent means the stock write LANDED (or there was none to make). It must
    // never be synthesised into a block: a false alarm on a healthy restock
    // trains the operator to ignore the real ones.
    restockBlocked:
      blocked === undefined || blocked === null
        ? null
        : {
            eventId: blocked.eventId,
            quantity: blocked.quantity,
            sku: orNull(blocked.sku),
            reason: blocked.reason,
            detail: orNull(blocked.detail),
            connectionId: orNull(blocked.connectionId),
            connectionName: orNull(blocked.connectionName),
            state: blocked.state,
          },
  };
}
