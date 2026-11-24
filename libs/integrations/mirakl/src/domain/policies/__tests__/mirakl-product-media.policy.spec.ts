/**
 * Mirakl Product Media Policy: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { readMiraklProductImages } from '../mirakl-product-media.policy';

describe('readMiraklProductImages', () => {
  it('should read the one picture object Empik returns', () => {
    // The shape Empik staging returned for the OpenLinker gadget card, 2026-11-24.
    expect(
      readMiraklProductImages({
        media_url: 'https://media-preprod-eu-1.mirakl.net/MEDIA/2ccbb47d991744f0a4b89becf28d848b',
        type: 'LARGE',
      })
    ).toEqual(['https://media-preprod-eu-1.mirakl.net/MEDIA/2ccbb47d991744f0a4b89becf28d848b']);
  });

  it('should read a list in order, once each', () => {
    expect(
      readMiraklProductImages([
        { media_url: 'https://m/a' },
        { media_url: 'https://m/b' },
        { media_url: 'https://m/a' },
      ])
    ).toEqual(['https://m/a', 'https://m/b']);
  });

  it('should give no images for a card without a picture', () => {
    expect(readMiraklProductImages(null)).toEqual([]);
    expect(readMiraklProductImages(undefined)).toEqual([]);
    expect(readMiraklProductImages([])).toEqual([]);
  });

  it('should skip an entry that is not an absolute http url', () => {
    expect(
      readMiraklProductImages([
        { media_url: '/MEDIA/relative' },
        { type: 'LARGE' },
        { media_url: ' ' },
      ])
    ).toEqual([]);
  });
});
