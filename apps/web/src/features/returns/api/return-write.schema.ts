/**
 * Return Write Schemas
 *
 * Parsers for the three orphan/manual-return writes (#2376, `W2-39`) —
 * authorize, match-to-order, and the operator-authored record — mirroring the
 * `return-custody.schema.ts` precedent: a response is PARSED, never cast, so a
 * contract break surfaces as a named failure instead of an `undefined`
 * rendered into a field an operator then trusts.
 *
 * `outcome` / `origin` are read as plain strings, not `z.enum`, for the same
 * reason `custodyState` is in `return-custody.schema.ts`: a value this build
 * predates must still round-trip — the write HAPPENED, and refusing to read
 * its result would report a failure for a change that landed.
 *
 * @module apps/web/src/features/returns/api
 */
import { z } from 'zod/v4';
import type {
  AuthorizeReturnResult,
  MatchReturnToOrderResult,
  RecordReturnResult,
} from './returns.types';

/** A write's response could not be read, though the write itself may have landed. */
export class ReturnWriteResultUnreadableError extends Error {
  constructor() {
    super('The server accepted the change but sent a result this build could not read.');
    this.name = 'ReturnWriteResultUnreadableError';
  }
}

function orNull<T>(value: T | null | undefined): T | null {
  return value === undefined || value === null ? null : value;
}

const authorizeResultSchema = z.object({
  outcome: z.string(),
  changeId: z.string().nullish(),
  authorizedAt: z.string().nullish(),
});

export function parseAuthorizeReturnResult(raw: unknown): AuthorizeReturnResult {
  const parsed = authorizeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReturnWriteResultUnreadableError();
  }
  return {
    outcome: parsed.data.outcome,
    changeId: orNull(parsed.data.changeId),
    authorizedAt: orNull(parsed.data.authorizedAt),
  };
}

const matchOrderResultSchema = z.object({
  returnId: z.string(),
  internalOrderId: z.string().nullish(),
  matchedAt: z.string().nullish(),
});

export function parseMatchReturnToOrderResult(raw: unknown): MatchReturnToOrderResult {
  const parsed = matchOrderResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReturnWriteResultUnreadableError();
  }
  return {
    returnId: parsed.data.returnId,
    internalOrderId: orNull(parsed.data.internalOrderId),
    matchedAt: orNull(parsed.data.matchedAt),
  };
}

const recordResultSchema = z.object({
  returnId: z.string(),
  internalOrderId: z.string().nullish(),
  origin: z.string(),
  openedAt: z.string(),
});

export function parseRecordReturnResult(raw: unknown): RecordReturnResult {
  const parsed = recordResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReturnWriteResultUnreadableError();
  }
  return {
    returnId: parsed.data.returnId,
    internalOrderId: orNull(parsed.data.internalOrderId),
    origin: parsed.data.origin,
    openedAt: parsed.data.openedAt,
  };
}
