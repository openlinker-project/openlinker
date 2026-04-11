/**
 * Auto-Match Variant Offers Service Interface
 *
 * Defines the contract for automatically matching product variants to marketplace
 * offers using shared identifiers (EAN/SKU).
 *
 * @module libs/core/src/products/application/services
 */
import { AutoMatchResult, AutoMatchOptions } from '../types/auto-match.types';

export interface IAutoMatchVariantOffersService {
  /**
   * Auto-match variants from the master catalog to marketplace offers.
   *
   * Fetches all offers from the marketplace connection, builds EAN/SKU lookup
   * indexes, then iterates variants from the master catalog and creates
   * identifier mappings for unique matches.
   *
   * @param connectionId - Marketplace connection ID (e.g., Allegro)
   * @param options - Options including dryRun mode
   * @returns Result with match/skip/error counts
   */
  autoMatch(connectionId: string, options: AutoMatchOptions): Promise<AutoMatchResult>;
}
