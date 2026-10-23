/**
 * Parcel Requirements Reader Capability
 *
 * Optional sub-capability of `ShippingProviderManagerPort` (#3651). Carriers
 * disagree on what a parcel must carry: one needs explicit length/width/height,
 * another a size template, a third only a weight. Core must not learn carrier
 * names to know which, so an adapter that REQUIRES explicit dimensions says so
 * here and auto-dispatch refuses (`no-dimensions`) before calling it, instead
 * of letting the carrier's own preflight fail after a label attempt.
 *
 * Absence means "no declared requirement": an adapter that does not implement
 * this is never refused on parcel shape by the caller, exactly as before.
 *
 * @module libs/core/src/shipping/domain/ports/capabilities
 */

import type { ShippingMethod } from '../../types/shipping-method.types';
import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';

export interface ParcelRequirements {
  /** The carrier rejects a label for this method without explicit L/W/H. */
  readonly requiresDimensions: boolean;
}

export interface ParcelRequirementsReader {
  /** Static per adapter and method; must not perform I/O. */
  getParcelRequirements(method: ShippingMethod): ParcelRequirements;
}

export function isParcelRequirementsReader(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & ParcelRequirementsReader {
  return (
    typeof (adapter as Partial<ParcelRequirementsReader>).getParcelRequirements === 'function'
  );
}
