/**
 * Saved View Definition Policy Port
 *
 * The page-aware half of definition validation. Core is page-agnostic (it does
 * not know what a valid filter query for `orders` looks like), so the host
 * supplies this: given the page and a definition that already passed the
 * shape/limit checks, return the definition to PERSIST - or throw
 * `InvalidSavedViewError`. It may rewrite (the API strips `search`, `offset`,
 * `cursor`, `limit` from the query so a shared view cannot carry a buyer's
 * email to every role).
 *
 * @module libs/core/src/saved-views/domain/ports
 */
import type { SavedViewDefinition } from '../types/saved-view.types';

export interface SavedViewDefinitionPolicyPort {
  normalise(pageKey: string, definition: SavedViewDefinition): Promise<SavedViewDefinition>;
}
