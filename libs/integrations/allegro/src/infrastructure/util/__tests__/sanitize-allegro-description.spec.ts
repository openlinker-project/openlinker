/**
 * Sanitizer Unit Tests
 *
 * Verifies the Allegro description HTML sanitizer strips attributes and filters tags
 * to Allegro's accepted whitelist, AND wraps plain-text / inline-only output in
 * `<p>…</p>` so the result satisfies Allegro's TEXT validator (#540). The
 * "real-world fixture" case is taken verbatim from the sandbox diagnostic captured
 * under #392 — the exact payload that triggered the original VALIDATION_ERROR
 * ("The \"p\" tag is of simple type and cannot have attributes") must round-trip
 * clean of attributes after sanitization.
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

  it('drops disallowed tags but preserves inner text (and wraps the bare result)', () => {
    // After stripping <div>/<span> the surviving content is plain text
    // ("plain text"), which Allegro rejects without a block-level wrapper.
    const input = '<div><span>plain</span> text</div>';
    expect(sanitizeAllegroDescription(input)).toBe('<p>plain text</p>');
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

  it('normalizes self-closing br variants to <br> and wraps the bare-br output', () => {
    // Bare <br>s have no block-level opener, so the whole string gets wrapped
    // — same behaviour Allegro requires for any leading-inline-tag input.
    expect(sanitizeAllegroDescription('a<br />b<br/>c<BR>d')).toBe('<p>a<br>b<br>c<br>d</p>');
  });

  it('lowercases tag names and ignores casing on attributes', () => {
    expect(sanitizeAllegroDescription('<P STYLE="x">UPPER</P>')).toBe('<p>UPPER</p>');
  });

  it('wraps plain text in <p>…</p> (#540)', () => {
    expect(sanitizeAllegroDescription('just text, no tags')).toBe('<p>just text, no tags</p>');
  });

  it('wraps inline-only output in <p>…</p> (#540)', () => {
    // Only inline tags survive sanitization → no block opener → wrap.
    expect(sanitizeAllegroDescription('<b>bold</b>')).toBe('<p><b>bold</b></p>');
    expect(sanitizeAllegroDescription('<i>italic</i> and <strong>strong</strong>')).toBe(
      '<p><i>italic</i> and <strong>strong</strong></p>',
    );
  });

  it('wraps bare <br>-only input in <p>…</p> (plan §5 R4)', () => {
    // `<br>` is inline; an input of just `<br>` (or a few of them) needs to
    // gain a block-level wrapper to satisfy Allegro's TEXT validator. This
    // case is rare in practice but locks the R4 contract from the plan as
    // a regression guard.
    expect(sanitizeAllegroDescription('<br>')).toBe('<p><br></p>');
    expect(sanitizeAllegroDescription('<br><br>')).toBe('<p><br><br></p>');
    expect(sanitizeAllegroDescription('<br />')).toBe('<p><br></p>');
  });

  it("doesn't double-wrap content that already starts with a block tag (#540)", () => {
    expect(sanitizeAllegroDescription('<p>x</p>')).toBe('<p>x</p>');
    expect(sanitizeAllegroDescription('<h1>title</h1>')).toBe('<h1>title</h1>');
    expect(sanitizeAllegroDescription('<h2>sub</h2><p>body</p>')).toBe('<h2>sub</h2><p>body</p>');
    expect(sanitizeAllegroDescription('<ul><li>one</li></ul>')).toBe('<ul><li>one</li></ul>');
    expect(sanitizeAllegroDescription('<ol><li>one</li></ol>')).toBe('<ol><li>one</li></ol>');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeAllegroDescription('')).toBe('');
  });

  it('collapses whitespace-only input to empty (contract symmetry with empty input, #540)', () => {
    // updateOfferFields has no `.trim().length > 0` gate at its call site, so
    // the sanitizer itself must collapse whitespace-only output to '' rather
    // than ship bare whitespace to Allegro.
    expect(sanitizeAllegroDescription('   ')).toBe('');
    expect(sanitizeAllegroDescription('   \n  \t  ')).toBe('');
    expect(sanitizeAllegroDescription('<div>   </div>')).toBe('');
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

  it('handles multi-byte UTF-8 characters when capping byte length and wraps the result', () => {
    // Polish characters (ą, ę, ł, …) are 2 bytes each in UTF-8 — naive char-count
    // truncation would let the byte count exceed the cap. Build an input where
    // every character is 2 bytes and verify the byte cap holds even after the
    // <p>…</p> wrap is added.
    const input = 'ą'.repeat(25000); // 50 000 bytes, no tags
    const output = sanitizeAllegroDescription(input);
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(40000);
    expect(output.startsWith('<p>')).toBe(true);
    expect(output.endsWith('</p>')).toBe(true);
  });

  it('honours the exact byte budget when wrap fires at the cap (#540)', () => {
    // Lock the wrap-vs-cap budget arithmetic against future drift. Plain ASCII
    // sized to exactly fill the budget once the <p>…</p> overhead is reserved.
    const wrapperOverhead = Buffer.byteLength('<p></p>', 'utf8'); // 7 bytes
    const innerBytes = 40000 - wrapperOverhead;
    const input = 'a'.repeat(innerBytes);
    const output = sanitizeAllegroDescription(input);
    expect(Buffer.byteLength(output, 'utf8')).toBe(40000);
    expect(output.startsWith('<p>')).toBe(true);
    expect(output.endsWith('</p>')).toBe(true);
  });

  it('wraps the #540 seed fixture (Bosch GSR plain-text description)', () => {
    // Verbatim-ish fixture text from the offer-create 422 reproduction in the
    // issue body. Plain prose, no tags — used to fail with
    // VALIDATION_ERROR / "Nieprawidłowy podzbiór HTML".
    const input =
      'Two-speed cordless drill / driver from the Bosch Professional 12V Li-Ion line. ' +
      'Compact body, 1300 RPM max speed, 30 Nm torque. Includes battery and charger.';
    const output = sanitizeAllegroDescription(input);
    expect(output.startsWith('<p>')).toBe(true);
    expect(output.endsWith('</p>')).toBe(true);
    expect(output).toContain('Two-speed cordless drill');
    expect(output).toContain('Includes battery and charger.');
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
    // The fixture already opens with <p>, so the sanitizer must NOT double-wrap.
    expect(output.startsWith('<p>')).toBe(true);
    expect(output.startsWith('<p><p>')).toBe(false);
  });
});
