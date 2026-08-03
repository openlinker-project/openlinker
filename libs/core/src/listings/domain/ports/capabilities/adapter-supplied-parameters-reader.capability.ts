/**
 * Adapter-Supplied Parameters Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — an adapter that derives some
 * required category parameters from NEUTRAL `CreateOfferCommand` fields (rather
 * than from projected source attributes or operator input) declares them here,
 * so the builder's required-parameter gate does not block on a value the
 * pipeline is already guaranteed to produce (#1934/F1).
 *
 * Motivating case: Allegro's "Stan" (id `11323`) is a REQUIRED offer-section
 * parameter, and the adapter synthesises it from `CreateOfferCommand.condition`
 * — which the builder always sets (defaulting to `'new'`). The gate runs before
 * the adapter, saw "Stan" unresolved, and rejected every offer whose operator
 * had not hand-mapped a parameter they were never shown. The parameter was
 * never actually missing; only the gate's view of it was.
 *
 * Core deliberately does not know which platform id means "condition" — that
 * neutral → wire mapping is the adapter's, so the adapter is what declares it.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { CreateOfferCommand } from '../../types/offer-create.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface AdapterSuppliedParametersReader {
  /**
   * Category-parameter ids this adapter will populate itself for `cmd`, from
   * neutral command fields alone. Returns an empty array when the command
   * carries nothing the adapter can derive a parameter from.
   */
  getAdapterSuppliedParameterIds(cmd: Pick<CreateOfferCommand, 'condition'>): readonly string[];
}

export function isAdapterSuppliedParametersReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & AdapterSuppliedParametersReader {
  return (
    typeof (adapter as Partial<AdapterSuppliedParametersReader>)
      .getAdapterSuppliedParameterIds === 'function'
  );
}
