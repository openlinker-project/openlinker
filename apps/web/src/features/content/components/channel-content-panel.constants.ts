/**
 * Channel Content Panel constants
 *
 * The format the channel editor renders against while the real contract is still
 * loading (ADR-046).
 *
 * Deliberately the narrow set rather than a permissive one: a formatting control
 * that appears a moment late is a smaller surprise than one that lets an operator
 * author a tag the destination then silently discards. `declared: false` is
 * honest here - nothing has declared anything yet - and the editor's own
 * "not declared" note is the correct thing to show for the fraction of a second
 * it is visible.
 *
 * @module apps/web/src/features/content/components
 */
import type { DescriptionFormat } from '../../../shared/ui';

export const CONSERVATIVE_FALLBACK_WHILE_LOADING: DescriptionFormat = {
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
    { from: 'br', action: 'split-block' },
  ],
  requiresBlockOpener: true,
  selfClosingVoids: false,
  maxBytes: 40000,
  declared: false,
  resolvedVia: null,
};
