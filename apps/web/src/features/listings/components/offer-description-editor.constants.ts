/**
 * Offer description editor constants
 *
 * The format the offer editor renders against while the destination's real
 * contract is in flight (ADR-046). The narrow set, deliberately - see
 * `channel-content-panel.constants.ts` for the same reasoning: erring narrow
 * costs a control that appears late, erring wide costs an operator authoring
 * markup the marketplace silently discards.
 *
 * @module apps/web/src/features/listings/components
 */
import type { DescriptionFormat } from '../../../shared/ui';

export const OFFER_DESCRIPTION_FALLBACK_FORMAT: DescriptionFormat = {
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
