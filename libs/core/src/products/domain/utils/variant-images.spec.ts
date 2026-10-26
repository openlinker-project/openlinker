import { normalizeVariantImages } from './variant-images';

describe('normalizeVariantImages', () => {
  it('should keep the master order and drop blanks and repeats', () => {
    expect(normalizeVariantImages([' https://a/1.jpg ', '', 'https://a/2.jpg', 'https://a/1.jpg'])).toEqual([
      'https://a/1.jpg',
      'https://a/2.jpg',
    ]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty list', []],
    ['only blanks', ['  ', '']],
  ])('should store %s as null', (_label, images) => {
    expect(normalizeVariantImages(images)).toBeNull();
  });
});
