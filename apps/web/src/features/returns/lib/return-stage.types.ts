/**
 * Return Stage — frontend mirror of the core vocabulary (#2377, spec § 3.2)
 *
 * Hand-copied from `libs/core/src/returns/domain/types/return-stage.types.ts`
 * because the browser bundle does not depend on `@openlinker/core`. A copy
 * drifts silently in BOTH directions — a stage added only to core never reaches
 * the browser, and one added only here type-checks against a value the API will
 * never send — so `scripts/check-return-stage-mirror.mjs` pins value and ORDER
 * equality as a `check:invariants` step.
 *
 * **The array order IS the ordinal.** First match wins, and the backend's SQL
 * `CASE` is built by iterating the same array, so a reorder changes behaviour
 * and is a hard mirror failure rather than a nit.
 *
 * The stage is a presentation projection and never a persisted column.
 *
 * @module apps/web/src/features/returns/lib
 */

export const RETURN_STAGE_VALUES = [
  'declined',
  'not_returned',
  'partially_received',
  'received_awaiting_disposition',
  'disposed',
  'awaiting_parcel',
] as const;

export type ReturnStage = (typeof RETURN_STAGE_VALUES)[number];

/**
 * Coercion for an UNTRUSTED string — a hand-edited search param, not a value
 * that has already been through the backend's validator. An unrecognised value
 * is ignored rather than forwarded: the API validates `stage` with `@IsIn`, so
 * passing junk through would 400 the whole page over a typo in the URL bar.
 */
export function isReturnStage(value: string | null | undefined): value is ReturnStage {
  return value !== null && value !== undefined && (RETURN_STAGE_VALUES as readonly string[]).includes(value);
}
