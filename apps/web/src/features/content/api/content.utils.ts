/**
 * Content Feature — Frontend Utilities
 *
 * Pure helpers around the content wire types (`content.types.ts`). Kept in a
 * separate module from `content.types.ts` so the types file stays type-only
 * per the engineering-standards "Type Definitions in Separate Files" rule.
 *
 * @module apps/web/src/features/content/api
 */

import {
  PromptTemplateChannelValues,
  type PromptTemplateChannel,
} from './content.types';

/**
 * Narrow a connection's `platformType` (free string on the wire) to the
 * closed `PromptTemplateChannel` union the AI-suggest endpoint accepts.
 * Returns `null` for marketplaces that don't yet have a published prompt
 * template — call sites should disable the Suggest button with an
 * explanatory hint instead of firing a request that would 404.
 *
 * Used by both `content-editor` (per-channel tabs) and the listings
 * `EditOfferDrawer` (#485). Wire values are lowercase (`'allegro'`,
 * `'prestashop'`); inputs that don't match exactly return `null`.
 */
export function resolveSuggestChannel(
  platformType: string,
): PromptTemplateChannel | null {
  return (PromptTemplateChannelValues as readonly string[]).includes(platformType)
    ? (platformType as PromptTemplateChannel)
    : null;
}
