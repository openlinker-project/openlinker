import { describe, expect, it } from 'vitest';
import { checkImageUrl, isAbsoluteHttpUrl } from './image-url';

describe('isAbsoluteHttpUrl', () => {
  it('should accept an https address', () => {
    expect(isAbsoluteHttpUrl('https://example.com/image.jpg')).toBe(true);
  });

  it('should accept an http address', () => {
    expect(isAbsoluteHttpUrl('http://shop.example/gfx/1.png')).toBe(true);
  });

  it('should accept an uppercase scheme', () => {
    expect(isAbsoluteHttpUrl('HTTPS://example.com/a.jpg')).toBe(true);
  });

  it.each([
    ['a relative path', '/userdata/gfx/1.jpg'],
    ['a bare host', 'example.com/image.jpg'],
    ['plain text', 'not a url'],
    ['a javascript: scheme', 'javascript:alert(1)'],
    ['a data: scheme', 'data:image/png;base64,AAAA'],
    ['an ftp address', 'ftp://example.com/a.jpg'],
    ['a scheme without slashes', 'https:example.com/a.jpg'],
    ['a scheme with no host', 'https://'],
    ['inner whitespace', 'https://example.com/my image.jpg'],
  ])('should reject %s', (_label, value) => {
    expect(isAbsoluteHttpUrl(value)).toBe(false);
  });
});

describe('checkImageUrl', () => {
  it('should return the trimmed address when it is valid', () => {
    expect(checkImageUrl('  https://example.com/a.jpg \n', [])).toEqual({
      ok: true,
      url: 'https://example.com/a.jpg',
    });
  });

  it('should report empty when only whitespace was typed', () => {
    expect(checkImageUrl('   ', [])).toEqual({ ok: false, problem: 'empty' });
  });

  it('should report not-a-url for garbage', () => {
    expect(checkImageUrl('not a url', [])).toEqual({ ok: false, problem: 'not-a-url' });
  });

  it('should report not-a-url for a javascript: scheme', () => {
    expect(checkImageUrl('javascript:alert(1)', [])).toEqual({ ok: false, problem: 'not-a-url' });
  });

  it('should report not-a-url for a relative path', () => {
    expect(checkImageUrl('images/a.jpg', [])).toEqual({ ok: false, problem: 'not-a-url' });
  });

  it('should report duplicate when the trimmed address is already in the list', () => {
    expect(checkImageUrl(' https://example.com/a.jpg ', ['https://example.com/a.jpg'])).toEqual({
      ok: false,
      problem: 'duplicate',
    });
  });

  it('should accept an address that differs from a listed one', () => {
    expect(checkImageUrl('https://example.com/b.jpg', ['https://example.com/a.jpg'])).toEqual({
      ok: true,
      url: 'https://example.com/b.jpg',
    });
  });
});
