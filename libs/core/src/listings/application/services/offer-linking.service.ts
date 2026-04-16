/**
 * Offer Linking Service
 *
 * Deterministically links marketplace offers to internal sellable items (variants).
 *
 * @module libs/core/src/listings/application/services
 */
import { Injectable } from '@nestjs/common';
import { MarketplaceOfferFeedItem } from '@openlinker/core/integrations';
import { normalizeBarcode as normalizeBarcodeValue, normalizeToEan13 } from '@openlinker/core/products';

export type OfferLinkMethod = 'externalRef' | 'sku' | 'ean' | 'gtin';

export interface OfferLinkingLookups {
  externalRefToVariantId: Map<string, string | null>;
  skuToVariantId: Map<string, string | null>;
  eanToVariantId: Map<string, string | null>;
  gtinToVariantId: Map<string, string | null>;
}

export interface OfferLinkingResult {
  status: 'linked' | 'skipped';
  internalVariantId?: string;
  linkMethod?: OfferLinkMethod;
  reason?: string;
}

@Injectable()
export class OfferLinkingService {
  linkOffer(item: MarketplaceOfferFeedItem, lookups: OfferLinkingLookups): OfferLinkingResult {
    const externalRef = this.normalize(item.externalRef);
    if (externalRef) {
      const match = lookups.externalRefToVariantId.get(externalRef);
      if (match) {
        return { status: 'linked', internalVariantId: match, linkMethod: 'externalRef' };
      }
      if (match === null) {
        return { status: 'skipped', reason: 'ambiguous_external_ref' };
      }
    }

    const sku = this.normalize(item.sku);
    if (sku) {
      const match = lookups.skuToVariantId.get(sku);
      if (match) {
        return { status: 'linked', internalVariantId: match, linkMethod: 'sku' };
      }
      if (match === null) {
        return { status: 'skipped', reason: 'ambiguous_sku' };
      }
    }

    const ean = normalizeToEan13(item.ean) ?? this.normalizeBarcode(item.ean);
    if (ean) {
      const match = lookups.eanToVariantId.get(ean);
      if (match) {
        return { status: 'linked', internalVariantId: match, linkMethod: 'ean' };
      }
      if (match === null) {
        return { status: 'skipped', reason: 'ambiguous_ean' };
      }
    }

    const gtin = this.normalizeBarcode(item.gtin);
    if (gtin) {
      const match = lookups.gtinToVariantId.get(gtin);
      if (match) {
        return { status: 'linked', internalVariantId: match, linkMethod: 'gtin' };
      }
      if (match === null) {
        return { status: 'skipped', reason: 'ambiguous_gtin' };
      }
    }

    return { status: 'skipped', reason: 'no_deterministic_match' };
  }

  private normalize(value?: string | null): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeBarcode(value?: string | null): string | null {
    return normalizeBarcodeValue(value ?? null);
  }
}
