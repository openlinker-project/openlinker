/**
 * Bench label service contract (#3654)
 *
 * The one place the bench may cause a label to be bought, and only as a
 * replacement of the label already on THIS work's box.
 *
 * @module apps/api/src/bench/application/interfaces
 */
import type { BenchReplaceLabelInput, BenchReplaceLabelResult } from '../types/bench-label.types';

export const BENCH_LABEL_SERVICE_TOKEN = Symbol('IBenchLabelService');

export interface IBenchLabelService {
  /**
   * Void the work's current outbound label and buy a new one with the packer's
   * parcel data. Recipient is derived server-side from the order.
   *
   * Raises `FulfillmentWorkNotFoundError` / `BenchParcelNotAtThisBenchError`
   * (controller answers 404) when the work is not a parcel of this bench, and
   * `BenchLabelShipmentNotFoundError` when the work has no shipment at all.
   * Every other refusal is a returned `refused` result with nothing changed.
   */
  replaceLabel(input: BenchReplaceLabelInput): Promise<BenchReplaceLabelResult>;
}
