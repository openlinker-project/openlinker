/**
 * Erli Description Format
 *
 * Erli accepts nine tags, PUBLISHED in its own API doc
 * (`erli.pl/svc/shop-api/doc/`, sections "Opisy" and "Opisy HTML"):
 * "W elemencie tekstowym można wykorzystywać wyłącznie określone znaczniki
 * HTML". Attributes forbidden, headings unformatted. Differences from
 * Allegro: `h3` is allowed, and `<br/>` is allowed but MUST be
 * self-closing - a bare `<br>` is not. The doc states no length limit; the
 * swagger says 80 000 characters, declared here as bytes with that caveat.
 *
 * Why declare a format at all when Erli never rejects: the same doc
 * describes a second path - "HTML przesłany w polu description jako tekst
 * nie ma żadnych ograniczeń wobec przesyłanych znaczników i obrazków. Po
 * przesłaniu zostanie skonwertowany do opisanej powyżej struktury" - warning
 * that the result "będzie wyglądał inaczej" and that images end up alone,
 * each in a new paragraph. We send a flat string, so we are on that path:
 * without this declaration the cost is silent fidelity loss the operator is
 * never told about, not a 4xx (ADR-046).
 */
import type { DescriptionFormat } from '@openlinker/core/listings';

export const ERLI_DESCRIPTION_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: ['h1', 'h2', 'h3', 'p', 'b', 'br', 'ol', 'ul', 'li'],
  allowedAttributes: {},
  contentModel: {
    root: ['h1', 'h2', 'h3', 'p', 'ul', 'ol'],
    p: ['b', 'br'],
    ul: ['li'],
    ol: ['li'],
    li: ['b', 'br', 'p'],
    h1: [],
    h2: [],
    h3: [],
  },
  // No `br` rewrite: unlike Allegro, Erli accepts it.
  rewrites: [
    { from: 'strong', action: 'rename', to: 'b' },
    { from: 'em', action: 'rename', to: 'b' },
    { from: 'i', action: 'rename', to: 'b' },
    { from: 'u', action: 'unwrap' },
  ],
  requiresBlockOpener: true,
  selfClosingVoids: true,
  maxBytes: 80_000,
};
