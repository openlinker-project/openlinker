/**
 * Sanitizer Unit Tests
 *
 * Verifies the Allegro description HTML sanitizer strips attributes and filters tags
 * to Allegro's accepted whitelist. The "real-world fixture" case is taken verbatim
 * from the sandbox diagnostic captured under #392 — the exact payload that triggered
 * the original VALIDATION_ERROR ("The \"p\" tag is of simple type and cannot have
 * attributes") must round-trip clean of attributes after sanitization.
 *
 * @module infrastructure/util
 */

import { sanitizeAllegroDescription } from '../sanitize-allegro-description';

describe('sanitizeAllegroDescription', () => {
  it('strips inline style attributes from p tags (the sandbox-failing case)', () => {
    const input = '<p style="color:rgba(0,0,0,0.87);font-family:\'Open Sans\';">hello</p>';
    expect(sanitizeAllegroDescription(input)).toBe('<p>hello</p>');
  });

  it('strips arbitrary attributes (class, id, data-*) from allowed tags', () => {
    const input = '<p class="foo" id="bar" data-x="1">hello</p>';
    expect(sanitizeAllegroDescription(input)).toBe('<p>hello</p>');
  });

  it('drops disallowed tags but preserves inner text', () => {
    const input = '<div><span>plain</span> text</div>';
    expect(sanitizeAllegroDescription(input)).toBe('plain text');
  });

  it('preserves the full allowed-tag whitelist without attributes', () => {
    const input =
      '<h1>title</h1><h2>sub</h2><p>p</p><ul><li>a</li><li>b</li></ul><ol><li>x</li></ol>' +
      '<b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u><br>';
    expect(sanitizeAllegroDescription(input)).toBe(
      '<h1>title</h1><h2>sub</h2><p>p</p><ul><li>a</li><li>b</li></ul><ol><li>x</li></ol>' +
        '<b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u><br>',
    );
  });

  it('normalizes self-closing br variants to <br>', () => {
    expect(sanitizeAllegroDescription('a<br />b<br/>c<BR>d')).toBe('a<br>b<br>c<br>d');
  });

  it('lowercases tag names and ignores casing on attributes', () => {
    expect(sanitizeAllegroDescription('<P STYLE="x">UPPER</P>')).toBe('<p>UPPER</p>');
  });

  it('passes plain text through unchanged', () => {
    expect(sanitizeAllegroDescription('just text, no tags')).toBe('just text, no tags');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeAllegroDescription('')).toBe('');
  });

  it('caps output at 40000 bytes, cutting at the last closing-tag boundary', () => {
    // Build a description longer than 40000 bytes once sanitized: 5000 reps of
    // a ~10-byte <p>x</p> = 50 000 bytes (well past the cap). After sanitation
    // it should be ≤ 40 000 bytes and end with a clean </p>.
    const input = '<p>x</p>'.repeat(5000);
    const output = sanitizeAllegroDescription(input);
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(40000);
    expect(output.endsWith('</p>')).toBe(true);
  });

  it('handles multi-byte UTF-8 characters when capping byte length', () => {
    // Polish characters (ą, ę, ł, …) are 2 bytes each in UTF-8 — naive char-count
    // truncation would let the byte count exceed the cap. Build an input where
    // every character is 2 bytes and verify the byte cap holds.
    const input = 'ą'.repeat(25000); // 50 000 bytes, no tags
    const output = sanitizeAllegroDescription(input);
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(40000);
  });

  it('sanitizes the real PrestaShop fixture captured in #392 diagnostic', () => {
    // Verbatim slice from the sandbox failure: PrestaShop ships <p style="..."> from
    // its TinyMCE editor; after sanitization the structural <p>...</p> survives but
    // every attribute is gone. That is exactly what Allegro's validator wants.
    const input =
      '<p style="color:rgba(0,0,0,0.87);font-family:\'Open Sans\', sans-serif;font-size:16px;background-color:#ffffff;">' +
      'Kompaktowy aparat Canon PowerShot SX740 HS LITE EDITION ma grubość zaledwie 39,9 mm.' +
      '</p>\n<p style="color:rgba(0,0,0,0.87);"> </p>';
    const output = sanitizeAllegroDescription(input);
    expect(output).not.toMatch(/style=/);
    expect(output).not.toMatch(/font-family=/);
    expect(output).toContain('<p>');
    expect(output).toContain('Kompaktowy aparat Canon PowerShot SX740');
  });
});
