/**
 * Sanitize Stored HTML - unit tests
 *
 * This is the XSS boundary (#2198), so the cases are grouped by attack shape
 * rather than by API surface, and there is a deliberate block asserting what is
 * KEPT: a pass that quietly destroys a shop's own formatting would be a
 * data-loss bug dressed as a security fix.
 *
 * @module libs/shared/src/html/__tests__
 */
import { sanitizeStoredHtml } from '../sanitize-stored-html';

describe('sanitizeStoredHtml', () => {
  describe('null handling', () => {
    it('should return null for null', () => {
      expect(sanitizeStoredHtml(null)).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(sanitizeStoredHtml(undefined)).toBeNull();
    });

    it('should preserve an empty string rather than collapsing it to null', () => {
      // "the operator cleared the description" is a different stored fact from
      // "there is no description".
      expect(sanitizeStoredHtml('')).toBe('');
    });
  });

  describe('script vectors', () => {
    it('should remove a script element and its body text', () => {
      // The body text matters: leaving it would put the attack source into an
      // operator-facing field even though it can no longer execute.
      const out = sanitizeStoredHtml('<p>ok</p><script>alert(1)</script>');
      expect(out).toBe('<p>ok</p>');
    });

    it('should remove an event-handler attribute', () => {
      expect(sanitizeStoredHtml('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
    });

    it('should remove onload from a body-like tag', () => {
      expect(sanitizeStoredHtml('<div onload="alert(1)">x</div>')).toBe('<div>x</div>');
    });

    it('should strip a javascript: href', () => {
      const out = sanitizeStoredHtml('<a href="javascript:alert(1)">t</a>');
      expect(out).not.toContain('javascript');
      expect(out).toContain('t');
    });

    it('should strip a case-obfuscated JaVaScRiPt: href', () => {
      expect(sanitizeStoredHtml('<a href="JaVaScRiPt:alert(1)">t</a>')).not.toMatch(/javascript/i);
    });

    it('should strip a data: URL on an image', () => {
      // Execution vector on an anchor, exfiltration vector on an image.
      expect(sanitizeStoredHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">')).not.toContain(
        'data:',
      );
    });

    it('should remove an iframe entirely', () => {
      expect(sanitizeStoredHtml('<p>a</p><iframe src="https://evil.example"></iframe>')).toBe(
        '<p>a</p>',
      );
    });

    it('should remove object and embed', () => {
      const out = sanitizeStoredHtml('<object data="x"></object><embed src="y">');
      expect(out).not.toContain('<object');
      expect(out).not.toContain('<embed');
    });

    it('should remove a style element and its body', () => {
      const out = sanitizeStoredHtml('<style>body{display:none}</style><p>a</p>');
      expect(out).toBe('<p>a</p>');
    });

    it('should not be defeated by malformed nesting', () => {
      const out = sanitizeStoredHtml('<p><script >alert(1)</script ></p>');
      expect(out).not.toMatch(/alert/);
    });

    it('should not be defeated by an attribute-split handler', () => {
      const out = sanitizeStoredHtml('<img src="x" on\terror="alert(1)">');
      expect(out).not.toMatch(/alert/);
    });

    it('should drop a protocol-relative URL rather than trusting the page scheme', () => {
      expect(sanitizeStoredHtml('<a href="//evil.example">t</a>')).not.toContain('evil.example');
    });
  });

  describe('what a real shop description keeps', () => {
    it('should keep a table, which PrestaShop and WooCommerce editors produce', () => {
      const input = '<table><tbody><tr><td>Waga</td><td>620 g</td></tr></tbody></table>';
      expect(sanitizeStoredHtml(input)).toBe(input);
    });

    it('should keep inline style and class', () => {
      // Safe to KEEP, not safe to render unreviewed. The browser sanitizes
      // again, and the destination format drops these on the way out.
      const input = '<p class="rte" style="margin:0">x</p>';
      expect(sanitizeStoredHtml(input)).toBe(input);
    });

    it('should keep an https link with target and rel', () => {
      const input = '<a href="https://shop.example/sizes" target="_blank" rel="noopener">Sizes</a>';
      expect(sanitizeStoredHtml(input)).toBe(input);
    });

    it('should keep a relative image src', () => {
      const input = '<img src="/img/product.jpg" alt="Product">';
      expect(sanitizeStoredHtml(input)).toContain('src="/img/product.jpg"');
    });

    it('should keep headings, lists and emphasis', () => {
      const input = '<h2>T</h2><ul><li><strong>a</strong> and <em>b</em></li></ul>';
      expect(sanitizeStoredHtml(input)).toBe(input);
    });

    it('should keep sup and sub, which some catalogues use for units', () => {
      const input = '<p>10 m<sup>2</sup> and H<sub>2</sub>O</p>';
      expect(sanitizeStoredHtml(input)).toBe(input);
    });

    it('should leave a full PrestaShop TinyMCE description structurally intact', () => {
      const input =
        '<div class="rte" style="font-family:Verdana"><h1><strong>Kurtka</strong></h1>' +
        '<p style="margin:0">Do <span style="font-weight:700">-20 °C</span>.<br>620 g.</p>' +
        '<table border="1"><tbody><tr><td>Waga</td></tr></tbody></table></div>';
      const out = sanitizeStoredHtml(input);
      for (const kept of ['<div', '<h1>', '<strong>', '<span', '<table', '<br', 'Verdana']) {
        expect(out).toContain(kept);
      }
    });

    it('should be idempotent on already-clean input', () => {
      const input = '<p>clean <b>enough</b></p>';
      expect(sanitizeStoredHtml(sanitizeStoredHtml(input))).toBe(input);
    });

    it('should be idempotent on hostile input', () => {
      const once = sanitizeStoredHtml('<p>a</p><script>alert(1)</script><img onerror="x">');
      expect(sanitizeStoredHtml(once)).toBe(once);
    });
  });

  describe('wider than any destination format', () => {
    it('should keep tags Allegro rejects, because narrowing is the publish path’s job', () => {
      // Allegro accepts seven tags; the master legitimately stores far more.
      // Narrowing here would destroy the operator's own catalogue content.
      const input = '<div><span>x</span><table><tbody><tr><td>y</td></tr></tbody></table></div>';
      const out = sanitizeStoredHtml(input);
      expect(out).toContain('<div>');
      expect(out).toContain('<table>');
    });
  });
});

