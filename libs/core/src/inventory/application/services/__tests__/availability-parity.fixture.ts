/**
 * Availability Parity Fixture (#2321, ADR-061)
 *
 * The matrix that pins the computed seam's arithmetic to the arithmetic the
 * four shipped publish sites already perform.
 *
 * **This file is #2323's contract, which is why it is exported rather than
 * inlined into a spec.** #2323 rewires `InventorySyncService`,
 * `OfferBuilderService`, `ProductPublishBuilderService` and the stock-at-risk
 * read onto `IAvailabilityService`; the only way that rewire is safe is if the
 * seam and the sites it replaces agree on every cell of this matrix, and the
 * cheapest way to guarantee that is for both specs to read the *same* cells. A
 * matrix restated in two places is a matrix that drifts.
 *
 * The expectation is written as an INDEPENDENT expression
 * (`expectedPublishedQuantity`) — deliberately not by calling `computeAtp`,
 * which would assert only that the function equals itself.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */
import type { VariantAvailability } from '../../../domain/types/inventory.types';

export interface AvailabilityParityCase {
  readonly name: string;
  /** Positions for the variant — several rows exercise multi-location / multi-source summing. */
  readonly rows: readonly {
    readonly availableQuantity: number;
    readonly locationId: string | null;
    readonly isStale: boolean;
  }[];
  /** Raw `Connection.config.stockSafetyBuffer`, including the invalid shapes operators actually type. */
  readonly configBuffer: unknown;
  /** The buffer `readStockSafetyBuffer` coerces the above to. */
  readonly coercedBuffer: number;
  /**
   * What the shipped publish sites write today, computed independently of the
   * production helpers: `max(0, Σ live available − coercedBuffer)`.
   */
  readonly expectedPublishedQuantity: number;
}

const sumLive = (rows: AvailabilityParityCase['rows']): number =>
  rows.filter((r) => !r.isStale).reduce((acc, r) => acc + r.availableQuantity, 0);

const makeCase = (
  name: string,
  rows: AvailabilityParityCase['rows'],
  configBuffer: unknown,
  coercedBuffer: number
): AvailabilityParityCase => ({
  name,
  rows,
  configBuffer,
  coercedBuffer,
  expectedPublishedQuantity: Math.max(0, sumLive(rows) - coercedBuffer),
});

/** Row shapes: single position, three locations, two sources on one location, stale mixed with live. */
const ROW_SHAPES: readonly { readonly label: string; readonly build: (stock: number) => AvailabilityParityCase['rows'] }[] = [
  {
    label: 'one row',
    build: (stock) => [{ availableQuantity: stock, locationId: 'loc-1', isStale: false }],
  },
  {
    label: 'three locations',
    build: (stock) => [
      { availableQuantity: stock, locationId: 'loc-1', isStale: false },
      { availableQuantity: stock, locationId: 'loc-2', isStale: false },
      { availableQuantity: stock, locationId: 'loc-3', isStale: false },
    ],
  },
  {
    label: 'two sources, one location',
    // ADR-058 decision 2: cross-source coexistence is legitimate and BOTH rows
    // count. Deduplicating here is #2319/#2325's problem, not this seam's.
    build: (stock) => [
      { availableQuantity: stock, locationId: 'loc-1', isStale: false },
      { availableQuantity: stock, locationId: 'loc-1', isStale: false },
    ],
  },
  {
    label: 'stale plus live',
    // The stale row contributes nothing — #1478's exclusion is upstream of the
    // formula, in the repository's `isStale = false` predicate.
    build: (stock) => [
      { availableQuantity: stock, locationId: 'loc-1', isStale: false },
      { availableQuantity: 999, locationId: 'loc-2', isStale: true },
    ],
  },
];

/** Buffers: unset, valid, and every invalid shape `readStockSafetyBuffer` coerces to 0. */
const BUFFERS: readonly { readonly label: string; readonly raw: unknown; readonly coerced: number }[] = [
  { label: 'unset', raw: undefined, coerced: 0 },
  { label: 'zero', raw: 0, coerced: 0 },
  { label: 'three', raw: 3, coerced: 3 },
  { label: 'thousand', raw: 1000, coerced: 1000 },
  { label: 'string "5"', raw: '5', coerced: 0 },
  { label: 'negative', raw: -3, coerced: 0 },
  { label: 'NaN', raw: Number.NaN, coerced: 0 },
  { label: 'fractional 2.7', raw: 2.7, coerced: 2 },
];

const STOCK_LEVELS = [0, 1, 7, 1000] as const;

/** The full stock × buffer × row-shape matrix. */
export const AVAILABILITY_PARITY_CASES: readonly AvailabilityParityCase[] = STOCK_LEVELS.flatMap(
  (stock) =>
    BUFFERS.flatMap((buffer) =>
      ROW_SHAPES.map((shape) =>
        makeCase(
          `stock=${stock} buffer=${buffer.label} rows=${shape.label}`,
          shape.build(stock),
          buffer.raw,
          buffer.coerced
        )
      )
    )
);

/** The `VariantAvailability` row the repository would return for a case, or `null` when it has no live rows. */
export function toVariantAvailabilityRow(
  variantId: string,
  testCase: AvailabilityParityCase,
  stockUpdatedAt: Date
): VariantAvailability | null {
  const live = testCase.rows.filter((r) => !r.isStale);
  if (live.length === 0) return null;
  return {
    productVariantId: variantId,
    totalAvailable: sumLive(testCase.rows),
    locationCount: new Set(live.map((r) => r.locationId)).size,
    stockUpdatedAt,
  };
}

/** `Connection.config` for a case — the key is omitted entirely when the buffer is unset. */
export function toConnectionConfig(testCase: AvailabilityParityCase): Record<string, unknown> {
  return testCase.configBuffer === undefined ? {} : { stockSafetyBuffer: testCase.configBuffer };
}
