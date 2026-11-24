/**
 * Resolve Allegro GPSR Declaration
 *
 * Pure rules for turning a product's neutral GPSR data (`CreateOfferCommand.gpsr`)
 * into the two values Allegro takes on `productSet[0]`: a responsible-producer
 * id from the seller's own registry, and a `safetyInformation` block.
 *
 * Product data is more specific than the connection's `sellerDefaults`, so it
 * wins wherever it can be expressed - but only through what the seller ALREADY
 * registered on Allegro. A producer is matched by name against
 * `GET /sale/responsible-producers` and never created: registering a producer
 * on the seller's behalf would be OpenLinker making a legal declaration the
 * seller never made. When no single registry entry matches, the caller keeps
 * the connection default and says so.
 *
 * Matching is exact after normalisation (Unicode NFC, trimmed, inner whitespace
 * collapsed, case-folded). It is deliberately not fuzzy: "Acme" and "Acme Sp. z
 * o.o." can be different legal entities, and a wrong producer on a safety
 * declaration is worse than the default the seller chose.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 */
import type { AllegroResponsibleProducerEntry } from '../../domain/types/allegro-api.types';
import type { AllegroSafetyInformation } from '../../domain/types/allegro-seller-defaults.types';

/** Allegro accepts 1-5000 characters on `safetyInformation.description` (#445). */
export const ALLEGRO_SAFETY_TEXT_MAX_LENGTH = 5000;

/** Why a product producer could not be expressed as an Allegro registry id. */
export type AllegroProducerMatchFailure = 'no-match' | 'ambiguous' | 'lookup-failed';

export type AllegroProducerMatch =
  | { readonly kind: 'matched'; readonly id: string }
  | { readonly kind: 'unmatched'; readonly reason: AllegroProducerMatchFailure };

/** The comparison key for a producer name. */
export function normalizeProducerName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The registry entry whose label (`name`) or registered trade name
 * (`producerData.tradeName`) equals the product's producer name. Two distinct
 * entries matching is ambiguous and matches nothing - picking one would be a
 * guess about which legal entity the product means.
 */
export function matchAllegroResponsibleProducer(
  entries: readonly AllegroResponsibleProducerEntry[],
  producerName: string,
): AllegroProducerMatch {
  const wanted = normalizeProducerName(producerName);
  if (wanted.length === 0) {
    return { kind: 'unmatched', reason: 'no-match' };
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    const labels = [entry.name, entry.producerData?.tradeName];
    if (labels.some((label) => typeof label === 'string' && normalizeProducerName(label) === wanted)) {
      ids.add(entry.id);
    }
  }
  if (ids.size === 1) {
    return { kind: 'matched', id: [...ids][0] };
  }
  return { kind: 'unmatched', reason: ids.size === 0 ? 'no-match' : 'ambiguous' };
}

/**
 * The product's safety text as Allegro's `TEXT` block, or null when there is
 * none or it is longer than Allegro accepts. Never truncated: a cut-off
 * warning can drop the sentence that mattered, so the caller falls back to the
 * connection default instead.
 */
export function toAllegroSafetyText(text: string | undefined): AllegroSafetyInformation | null {
  const trimmed = text?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > ALLEGRO_SAFETY_TEXT_MAX_LENGTH) {
    return null;
  }
  return { type: 'TEXT', description: trimmed };
}
