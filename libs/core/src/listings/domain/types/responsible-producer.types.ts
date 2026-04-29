/**
 * Responsible Producer Types
 *
 * Neutral shape returned by `ResponsibleProducerReader.fetchResponsibleProducers()`
 * — a marketplace-agnostic view of the EU GPSR-mandated responsible-producer
 * registry. Adapters that implement the `ResponsibleProducerReader` capability
 * map their platform-native registry into this shape so the FE settings page
 * can render a connection-level dropdown without knowing about marketplace
 * specifics. Today only Allegro implements it (#430).
 *
 * Framework-free. Interface-layer DTOs decorate these fields with Swagger
 * annotations separately.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * Operator-classification of a registered responsible-producer entry, as
 * required by EU Regulation 2023/988 (GPSR). Mirrors Allegro's enum but
 * named neutrally so other marketplaces can map their own classifications
 * onto the same values.
 */
export const ResponsibleProducerKindValues = [
  'PRODUCER',
  'IMPORTER',
  'AUTHORIZED_REPRESENTATIVE',
  'FULFILLMENT_SERVICE_PROVIDER',
] as const;

export type ResponsibleProducerKind = (typeof ResponsibleProducerKindValues)[number];

export interface ResponsibleProducerEntry {
  /** Platform-native id used by `productSet[*].responsibleProducer.{ id }` on offer create. */
  id: string;
  /** Human-readable label for dropdown display (operator-facing). */
  name: string;
  /** GPSR classification. */
  kind: ResponsibleProducerKind;
}
