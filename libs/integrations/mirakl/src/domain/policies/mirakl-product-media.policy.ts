/**
 * Mirakl Product Media Policy
 *
 * Which picture urls of a catalogue card become the product's images (#4284).
 * P11 returns `product_media` as one object, a list or `null`; only an
 * absolute `http(s)` url is kept, once, in the order Mirakl gives them. A card
 * without a picture answers an empty list, never an invented url.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { MiraklCardMedia, MiraklProductWithOffers } from '../types/mirakl-offer.types';

/** The card's picture urls, possibly empty. */
export function readMiraklProductImages(media: MiraklProductWithOffers['product_media']): string[] {
  if (!media) {
    return [];
  }
  const list: readonly MiraklCardMedia[] = isMediaList(media) ? media : [media];
  const urls: string[] = [];
  for (const item of list) {
    const url = typeof item?.media_url === 'string' ? item.media_url.trim() : '';
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls;
}

function isMediaList(
  media: MiraklCardMedia | readonly MiraklCardMedia[]
): media is readonly MiraklCardMedia[] {
  return Array.isArray(media);
}
