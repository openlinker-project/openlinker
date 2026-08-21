/**
 * Allegro Description Format
 *
 * Allegro accepts seven tags with a CONTEXT-SENSITIVE content model, no
 * attributes, a block opener, and 40 000 bytes (ADR-046).
 *
 * Allegro publishes no tag list. Every value below is reconstructed from
 * verbatim validator rejection messages in `allegro/allegro-api`:
 *   #11708 (2025-06-24)  Błędny tag "br", dozwolone są: {b}
 *   #9714  (2024-08-22)  Błędny tag "strong", dozwolone są: {b}
 *                        Błędny tag "b", dozwolone są: {h1, h2, p, ul, ol}
 *   #10656 (2025-01-13)  Błędny tag "ul", dozwolone są: {b, p}
 *   #3856               Błędny tag "h2", dozwolone są: {b}
 * Two opposite allowed sets for one payload (#9714) is what makes this a
 * grammar rather than a list. #3856 also carries an Allegro employee stating
 * `<br>` is not accepted and that h1/h2 take no additional formatting.
 *
 * Do not widen this set without a new rejection message to cite - the spec
 * pins it exactly so a widening is a deliberate test change.
 */
import type { DescriptionFormat } from '@openlinker/core/listings';

export const ALLEGRO_DESCRIPTION_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: ['h1', 'h2', 'p', 'ul', 'ol', 'li', 'b'],
  allowedAttributes: {},
  contentModel: {
    root: ['h1', 'h2', 'p', 'ul', 'ol'],
    p: ['b'],
    ul: ['li'],
    ol: ['li'],
    li: ['b', 'p'],
    h1: [],
    h2: [],
  },
  rewrites: [
    { from: 'strong', action: 'rename', to: 'b' },
    { from: 'em', action: 'rename', to: 'b' },
    { from: 'i', action: 'rename', to: 'b' },
    { from: 'u', action: 'unwrap' },
    // Allegro's own guidance for the `<br>` it rejects: "użyj <p></p>".
    { from: 'br', action: 'split-block' },
  ],
  requiresBlockOpener: true,
  maxBytes: 40_000,
};
