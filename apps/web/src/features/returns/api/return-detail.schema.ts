/**
 * Return Detail Schema
 *
 * Zod parse of the `GET /returns/:returnId` projection and of the
 * `POST /returns/:returnId/decline` result (#2336).
 *
 * It follows `returns.schema.ts` (#2335) on `.nullish()` — OpenLinker
 * serialises an absent optional field as JSON `null`, and a bare `.optional()`
 * rejects it (#939) — and departs from it on two points, both deliberate.
 *
 * **The envelope THROWS rather than degrading.** The list can render an
 * unreadable page as "0 rows, N dropped" because the page is a set. A detail is
 * one record: a header of blanks is not a partial view of a return, it is a
 * screen making claims about a return it could not read. So an unreadable
 * envelope raises {@link ReturnDetailUnreadableError} and the page shows an
 * error state that says the record could not be read — distinct from the
 * network-failure state, which points the operator at a problem they do not
 * have.
 *
 * **A malformed LINE drops itself and is counted**, exactly as a malformed row
 * does in the list, and for the same reason: one bad line must not cost the
 * operator the other nine.
 *
 * **An unrecognised union VALUE never drops a line.** `custodyState`,
 * `moneyState`, `disposition` and `reason` are read as plain strings. A value
 * this build predates is a real state of a real parcel; rendering it verbatim
 * is honest, and dropping the line would hide goods that physically exist.
 * `bucket` and `origin` are the exception and stay closed — they are the header
 * of the record and the whole page branches on them.
 *
 * @module apps/web/src/features/returns/api
 */
import { z } from 'zod/v4';
import {
  RETURN_BUCKET_VALUES,
  RETURN_ORIGIN_VALUES,
  type ReturnDeclineAvailability,
  type ReturnDetail,
  type ReturnLine,
  type DeclineReturnResult,
} from './returns.types';

/**
 * The server answered, and this build could not read the record.
 *
 * A distinct error type rather than a generic `Error` so the page can tell it
 * apart from an `ApiError` (network / HTTP) and say something true about each.
 */
export class ReturnDetailUnreadableError extends Error {
  readonly returnId: string;

  constructor(returnId: string) {
    super(`Return ${returnId} could not be read`);
    this.name = 'ReturnDetailUnreadableError';
    this.returnId = returnId;
  }
}

const returnLineSchema = z.object({
  id: z.string(),
  lineIndex: z.number(),
  externalLineId: z.string().nullish(),
  resolvedOrderLineId: z.string().nullish(),
  offerId: z.string().nullish(),
  sku: z.string().nullish(),
  name: z.string().nullish(),
  reason: z.string(),
  quantityAdvised: z.number(),
  quantityReceived: z.number(),
  quantityRestocked: z.number(),
  quantityScrapped: z.number(),
  custodyState: z.string(),
  moneyState: z.string(),
  disposition: z.string().nullish(),
  receivedAt: z.string().nullish(),
  disposedAt: z.string().nullish(),
  note: z.string().nullish(),
});

const declineAvailabilitySchema = z.object({
  supported: z.boolean(),
  reason: z.string().nullish(),
});

/** #2377 — the counter rollup, mirroring the list schema's own defaulted shape. */
const returnCountersSchema = z.object({
  lineCount: z.number().nullish(),
  notReturnedLineCount: z.number().nullish(),
  quantityAdvised: z.number().nullish(),
  notReturnedQuantityAdvised: z.number().nullish(),
  quantityReceived: z.number().nullish(),
  quantityRestocked: z.number().nullish(),
  quantityScrapped: z.number().nullish(),
});

const returnDetailSchema = z.object({
  id: z.string(),
  counters: returnCountersSchema.nullish(),
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
  lines: z.array(z.unknown()).nullish(),
  declineAvailability: declineAvailabilitySchema.nullish(),
});

const declineResultSchema = z.object({
  outcome: z.string(),
  changeId: z.string().nullish(),
  declinedAt: z.string().nullish(),
  refusalReason: z.string().nullish(),
});

/** Collapse `undefined` and `null` — both mean "not reported" — onto `null`. */
function orNull<T>(value: T | null | undefined): T | null {
  return value === undefined || value === null ? null : value;
}

/**
 * The fallback when the server sent no readable `declineAvailability`.
 *
 * `supported: false` with a reason of `null`, matching the backend's own
 * asymmetry: `false` is the reliable direction (its two causes are properties
 * of the record and the platform, and no retry changes either), whereas a
 * fabricated `true` would render an enabled button for a write the source may
 * never accept. The UI renders the unrecognised-reason sentence, which says
 * OpenLinker could not establish whether the channel accepts a decline — a
 * different claim from "the channel does not accept one".
 */
const UNREADABLE_DECLINE_AVAILABILITY: ReturnDeclineAvailability = {
  supported: false,
  reason: null,
};

/**
 * Parse one return with its lines.
 *
 * @throws {ReturnDetailUnreadableError} when the envelope itself is unreadable.
 */
export function parseReturnDetail(raw: unknown, returnId: string): ReturnDetail {
  const parsed = returnDetailSchema.safeParse(raw);

  if (!parsed.success) {
    throw new ReturnDetailUnreadableError(returnId);
  }

  const lines: ReturnLine[] = [];
  let droppedLineCount = 0;

  for (const rawLine of parsed.data.lines ?? []) {
    const line = returnLineSchema.safeParse(rawLine);
    if (!line.success) {
      droppedLineCount += 1;
      continue;
    }
    lines.push({
      id: line.data.id,
      lineIndex: line.data.lineIndex,
      externalLineId: orNull(line.data.externalLineId),
      resolvedOrderLineId: orNull(line.data.resolvedOrderLineId),
      offerId: orNull(line.data.offerId),
      sku: orNull(line.data.sku),
      name: orNull(line.data.name),
      reason: line.data.reason,
      quantityAdvised: line.data.quantityAdvised,
      quantityReceived: line.data.quantityReceived,
      quantityRestocked: line.data.quantityRestocked,
      quantityScrapped: line.data.quantityScrapped,
      custodyState: line.data.custodyState,
      moneyState: line.data.moneyState,
      disposition: orNull(line.data.disposition),
      receivedAt: orNull(line.data.receivedAt),
      disposedAt: orNull(line.data.disposedAt),
      note: orNull(line.data.note),
    });
  }

  const availability = parsed.data.declineAvailability;

  return {
    id: parsed.data.id,
    // #2377 — the detail response spreads the same list-item projection, so the
    // counters are present. Defaulted rather than required for the same reason
    // the list schema defaults them: a response predating #2377 is still a
    // readable return, and losing it over a missing projection is worse than
    // deriving `Awaiting parcel`.
    counters: {
      lineCount: parsed.data.counters?.lineCount ?? 0,
      notReturnedLineCount: parsed.data.counters?.notReturnedLineCount ?? 0,
      quantityAdvised: parsed.data.counters?.quantityAdvised ?? 0,
      notReturnedQuantityAdvised: parsed.data.counters?.notReturnedQuantityAdvised ?? 0,
      quantityReceived: parsed.data.counters?.quantityReceived ?? 0,
      quantityRestocked: parsed.data.counters?.quantityRestocked ?? 0,
      quantityScrapped: parsed.data.counters?.quantityScrapped ?? 0,
    },
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
    // The server orders by `lineIndex`; this preserves that order rather than
    // re-sorting, so the page shows the sequence the source reported.
    lines,
    droppedLineCount,
    declineAvailability:
      availability === undefined || availability === null
        ? UNREADABLE_DECLINE_AVAILABILITY
        : { supported: availability.supported, reason: orNull(availability.reason) },
  };
}

/**
 * Parse the decline result.
 *
 * `outcome` is read as a plain string: an outcome this build predates must
 * still be reported to the operator (as the unrecognised branch), because the
 * request was made and something happened at the source. Throwing here would
 * report a failure for a write that may well have succeeded.
 */
export function parseDeclineReturnResult(raw: unknown): DeclineReturnResult {
  const parsed = declineResultSchema.safeParse(raw);

  if (!parsed.success) {
    return { outcome: '', changeId: null, declinedAt: null, refusalReason: null };
  }

  return {
    outcome: parsed.data.outcome,
    changeId: orNull(parsed.data.changeId),
    declinedAt: orNull(parsed.data.declinedAt),
    refusalReason: orNull(parsed.data.refusalReason),
  };
}
