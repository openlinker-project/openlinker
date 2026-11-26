/**
 * Mirakl Return Types
 *
 * RT11 (`GET /api/returns`) as Mirakl's Seller API documents it. Empik
 * staging has the returns module on but no return yet, so these follow the
 * documentation; a real staging return is the fixture to update them against.
 * RT12 (`/api/returns/items_to_return`) lists returnable lines, not returns,
 * and is not read.
 *
 * @module libs/integrations/mirakl/src/domain/types
 */

/** Documented RT11 states. */
export const MiraklReturnStateValues = [
  'WAITING_ACCEPTANCE',
  'IN_PROGRESS',
  'REFUSED',
  'RECEIVED',
  'NO_RECEPTION',
  'CLOSED',
  'CANCELED',
] as const;
export type MiraklReturnState = (typeof MiraklReturnStateValues)[number];

export interface MiraklReturnLine {
  readonly order_line_id?: string;
  readonly quantity?: number;
  /** e.g. `RETURN_BROKEN_ITEM`; the same list as the return-level code. */
  readonly reason_code?: string;
}

export interface MiraklReturn {
  readonly id?: string;
  readonly order_id?: string;
  readonly order_commercial_id?: string;
  readonly state?: string;
  readonly date_created?: string;
  readonly last_updated?: string;
  readonly reason_code?: string;
  readonly rma?: string;
  readonly method_code?: string;
  readonly return_lines?: readonly MiraklReturnLine[];
}
