/**
 * Responsible Producer Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can list the
 * EU GPSR responsible-producer registry on the seller's account declare
 * `implements ResponsibleProducerReader`. Required at offer-create time on
 * Allegro (`productSet[*].responsibleProducer.{ id }`); the FE connection
 * settings page consumes this to populate the seller-defaults dropdown
 * (#430). Mirrors the `seller-policies-reader.capability.ts` shape.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { ResponsibleProducerEntry } from '../../types/responsible-producer.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface ResponsibleProducerReader {
  fetchResponsibleProducers(): Promise<ResponsibleProducerEntry[]>;
}

export function isResponsibleProducerReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & ResponsibleProducerReader {
  return (
    typeof (adapter as Partial<ResponsibleProducerReader>).fetchResponsibleProducers ===
    'function'
  );
}
