/**
 * Stock correction preview (#3567, mockup m6, D26)
 *
 * What each channel will publish once a correction lands. It starts from
 * AVAILABLE TO PROMISE, not the raw master count: new available to promise is
 * `max(0, newMaster - heldCounted)`, then each channel applies its own safety
 * buffer and zero threshold through the browser mirror of the publish policy
 * (`applyStockSafetyBuffer`, pinned to core by `check:invariants`).
 *
 * An unknown held count means available to promise cannot be worked out, and
 * the answer is `null` ("Unknown"), never a number - the stock panel's rule.
 *
 * @module apps/web/src/features/inventory/lib
 */
import { applyStockSafetyBuffer } from '../../connections';
import type { StockViewChannel, StockViewVariant } from '../api/inventory.types';

export interface ChannelPreview {
  connectionId: string;
  connectionName: string;
  platformType: string;
  /** `null` when available to promise is unknown. */
  quantity: number | null;
  stockSafetyBuffer: number;
  stockZeroThreshold: number;
}

export interface CorrectionPreview {
  /** What the product master will show after the correction. */
  masterQuantity: number;
  /** `null` when the held count could not be read. */
  availableToPromise: number | null;
  heldCounted: number | null;
  channels: ChannelPreview[];
}

export function computeCorrectionPreview(input: {
  newMasterQuantity: number;
  /** The corrected position's current quantity, to account for sibling positions. */
  currentQuantity: number | null;
  stock: StockViewVariant | null;
}): CorrectionPreview {
  const { newMasterQuantity, currentQuantity, stock } = input;
  if (stock === null) {
    return {
      masterQuantity: newMasterQuantity,
      availableToPromise: null,
      heldCounted: null,
      channels: [],
    };
  }
  // Other live positions of the variant keep their stock; for the usual single
  // position this is 0 and the total is just the new number.
  const others = currentQuantity === null ? 0 : Math.max(0, stock.masterAvailable - currentQuantity);
  const heldCounted = stock.heldCounted;
  const atp = heldCounted === null ? null : Math.max(0, newMasterQuantity + others - heldCounted);
  return {
    masterQuantity: newMasterQuantity,
    availableToPromise: atp,
    heldCounted,
    channels: stock.channels.map((channel) => previewChannel(channel, atp)),
  };
}

function previewChannel(channel: StockViewChannel, atp: number | null): ChannelPreview {
  const buffer = channel.rule?.stockSafetyBuffer ?? 0;
  const threshold = channel.rule?.stockZeroThreshold ?? 0;
  return {
    connectionId: channel.connectionId,
    connectionName: channel.connectionName,
    platformType: channel.platformType,
    quantity: atp === null ? null : applyStockSafetyBuffer(atp, buffer, threshold),
    stockSafetyBuffer: buffer,
    stockZeroThreshold: threshold,
  };
}

/** The signed change a form entry means against the current stock. */
export function correctionDelta(mode: 'set' | 'delta', quantity: number, current: number): number {
  return mode === 'set' ? quantity - current : quantity;
}

/** Mirrors the server's confirmation rule (D41): >50 units, or >50% of a non-zero stock. */
export const LARGE_CHANGE_ABSOLUTE_UNITS = 50;
export const LARGE_CHANGE_RELATIVE = 0.5;

export function isLargeChange(delta: number, current: number): boolean {
  const abs = Math.abs(delta);
  return abs > LARGE_CHANGE_ABSOLUTE_UNITS || (current > 0 && abs > current * LARGE_CHANGE_RELATIVE);
}

/** Parse "+3", "-2", "−2" (typographic minus) or "5". `null` for anything else. */
export function parseSignedInteger(raw: string): number | null {
  const normalised = raw.trim().replace(/−/g, '-');
  if (!/^[+-]?\d+$/.test(normalised)) return null;
  const value = Number(normalised);
  return Number.isSafeInteger(value) ? value : null;
}
