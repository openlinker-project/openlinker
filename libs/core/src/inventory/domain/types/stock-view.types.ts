/**
 * Stock View Types (#3621)
 *
 * The read model behind the operator's stock panel: what the master reports,
 * what OpenLinker will promise, how much of the gap is OpenLinker's own
 * advisory holds, and how fresh the whole picture is.
 *
 * Every figure that OpenLinker may not know is `number | null`, never `0`: a
 * `null` here says "could not be determined" and a UI must say so rather than
 * render a quantity (ADR-061 decision 2).
 *
 * @module libs/core/src/inventory/domain/types
 */
import type { AvailabilityProvenance } from './availability.types';

/** One live-or-stale position (an `inventory_items` row) behind a variant's stock. */
export interface StockViewPosition {
  readonly locationId: string | null;
  /** Owning connection; `null` / `'legacy'` mean provenance not yet backfilled. */
  readonly sourceConnectionId: string | null;
  /** A stale position no longer counts towards any total; it is listed so a UI can say so. */
  readonly isStale: boolean;
  readonly availableQuantity: number;
  /** The MASTER's own reservation bookkeeping, never OpenLinker's ledger. */
  readonly reservedQuantity: number;
  /** When the position was last written by a stock sync. */
  readonly updatedAt: Date;
}

/**
 * One live `held` reservation against a variant (#3621), for the "who is this
 * promised to" chips. `atpEffect` says whether it reduces the promise
 * (`published`) or is recorded only (`diagnostic`).
 */
export interface StockViewHold {
  readonly orderRecordId: string;
  readonly quantity: number;
  readonly atpEffect: 'published' | 'diagnostic';
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** One variant's stock picture. */
export interface VariantStockView {
  readonly productVariantId: string;
  /** Sum of `availableQuantity` over LIVE positions (0 when there are none). */
  readonly masterAvailable: number;
  /** Sum of the master's own `reservedQuantity` over LIVE positions. */
  readonly masterReserved: number;
  /** Global-scope promise, no channel buffer. `null` ⇔ `provenance === 'unknown'`. */
  readonly availableToPromise: number | null;
  readonly provenance: AvailabilityProvenance;
  /** Newest `updatedAt` across live positions; `null` when the variant has none. */
  readonly observedAt: Date | null;
  readonly stalenessMs: number | null;
  readonly olHeldNotReflected: number | null;
  /** Units OpenLinker holds that reduce the promise (`atpEffect = 'published'`). `null` = unknown. */
  readonly heldCounted: number | null;
  /** Units OpenLinker has recorded that restrict nothing (`atpEffect = 'diagnostic'`). `null` = unknown. */
  readonly heldRecordedOnly: number | null;
  readonly livePositionCount: number;
  readonly positions: readonly StockViewPosition[];
  /**
   * The newest `STOCK_VIEW_HOLDS_PER_VARIANT` live holds, newest first. `null`
   * means the holds could not be read - never "no holds"; an empty array is the
   * confirmed absence.
   */
  readonly holds: readonly StockViewHold[] | null;
  /** `stalenessMs` exceeds the caller's threshold. `false` when staleness is unknown. */
  readonly isStaleSync: boolean;
}

export interface GetStockViewInput {
  readonly variantIds: readonly string[];
  readonly now?: Date;
  /** How old an observation may be before it is flagged. Passed in: core does not read settings. */
  readonly staleSyncThresholdMs: number;
}

/** Per-call input cap, mirroring the availability endpoint's 200-id request cap. */
export const MAX_STOCK_VIEW_VARIANT_IDS = 200;

/** How many live holds the view lists per variant (the rest are counted in `heldCounted`). */
export const STOCK_VIEW_HOLDS_PER_VARIANT = 20;
