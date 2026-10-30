/**
 * Inventory Correction Errors (#3566)
 *
 * Refusals decided BEFORE the product master is reached: nothing was written and
 * nothing crossed the boundary. Each carries a closed `reason` the HTTP layer
 * exposes as a machine-readable `code`.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
import {
  INVENTORY_CORRECTION_CONFIRM_ABSOLUTE_UNITS,
  INVENTORY_CORRECTION_CONFIRM_RELATIVE_SHARE,
  type InventoryCorrectionPreconditionReason,
  type InventoryCorrectionTargetRefusalReason,
} from '../types/inventory-correction.types';

export class InventoryCorrectionVariantNotFoundError extends Error {
  constructor(public readonly productVariantId: string) {
    super(`Product variant not found: ${productVariantId}`);
    this.name = 'InventoryCorrectionVariantNotFoundError';
  }
}

/** No single product master could be named for the variant's stock. */
export class InventoryCorrectionTargetRefusedError extends Error {
  constructor(public readonly reason: InventoryCorrectionTargetRefusalReason) {
    super(`The stock correction has no single product master to write to: ${reason}`);
    this.name = 'InventoryCorrectionTargetRefusedError';
  }
}

/** The request is well-formed but the state refuses it (no change, unreadable master, ...). */
export class InventoryCorrectionRefusedError extends Error {
  constructor(
    public readonly reason: InventoryCorrectionPreconditionReason,
    detail: string,
    /** The master quantity the refusal was judged against (`insufficient-stock`). */
    public readonly currentQuantity?: number
  ) {
    super(detail);
    this.name = 'InventoryCorrectionRefusedError';
  }
}

/** D41: a large change needs `confirmLargeChange`. Names both thresholds. */
export class CorrectionConfirmationRequiredError extends Error {
  readonly absoluteThresholdUnits = INVENTORY_CORRECTION_CONFIRM_ABSOLUTE_UNITS;
  readonly relativeThreshold = INVENTORY_CORRECTION_CONFIRM_RELATIVE_SHARE;

  constructor(
    public readonly requestedDelta: number,
    public readonly currentQuantity: number
  ) {
    super(
      `A change of ${String(requestedDelta)} units on a stock of ${String(currentQuantity)} ` +
        `exceeds ${String(INVENTORY_CORRECTION_CONFIRM_ABSOLUTE_UNITS)} units or ` +
        `${String(INVENTORY_CORRECTION_CONFIRM_RELATIVE_SHARE * 100)}% of the current stock; ` +
        'confirm it explicitly'
    );
    this.name = 'CorrectionConfirmationRequiredError';
  }
}

/** Another correction (or sale) for the same stock position is in flight. */
export class CorrectionContendedError extends Error {
  constructor() {
    super("Another stock change for this product master's position is in flight; try again");
    this.name = 'CorrectionContendedError';
  }
}
