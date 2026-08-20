/**
 * Apply Description Format - unit tests
 *
 * The cases are organised by the stage of the pass they exercise, because the
 * ordering between those stages is itself a decision (ADR-046): rewrites run
 * before the allowlist, and the content model runs after it.
 *
 * The two end-to-end cases at the bottom are the ones that matter most - they
 * feed real PrestaShop TinyMCE markup through the Allegro and Erli formats and
 * assert the exact payload, which is what `sanitizeAllegroDescription` got
 * wrong for five tags.
 *
 * @module libs/core/src/listings/application/services
 */
import { applyDescriptionFormat } from './apply-description-format';
import {
  CONSERVATIVE_DESCRIPTION_FORMAT,
  type DescriptionFormat,
} from '../../domain/types/description-format.types';

/** Allegro: seven tags, context-sensitive, no attributes, 40 000 bytes. */
const ALLEGRO: DescriptionFormat = CONSERVATIVE_DESCRIPTION_FORMAT;

/** Erli: nine tags, allows h3, requires a self-closing `<br/>`. */
const ERLI: DescriptionFormat = {
  shape: 'html',
  allowedTags: ['h1', 'h2', 'h3', 'p', 'b', 'br', 'ol', 'ul', 'li'],
  allowedAttributes: {},
  contentModel: {
    root: ['h1', 'h2', 'h3', 'p', 'ul', 'ol'],
    p: ['b', 'br'],
    ul: ['li'],
    ol: ['li'],
    li: ['b', 'br', 'p'],
    h1: [],
    h2: [],
    h3: [],
  },
  rewrites: [
    { from: 'strong', action: 'rename', to: 'b' },
    { from: 'em', action: 'rename', to: 'b' },
    { from: 'i', action: 'rename', to: 'b' },
    { from: 'u', action: 'unwrap' },
  ],
  requiresBlockOpener: true,
  selfClosingVoids: true,
  maxBytes: 80000,
};

/** A permissive shop: flat allowlist, no content model, links keep href. */
const SHOP: DescriptionFormat = {
  shape: 'html',
  allowedTags: ['h1', 'h2', 'h3', 'p', 'br', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'a'],
  allowedAttributes: { a: ['href'] },
  contentModel: null,
  rewrites: [],
  maxBytes: 65536,
};

describe('applyDescriptionFormat', () => {
  describe('empty input', () => {
    it('should return an empty string when the input is empty', () => {
      expect(applyDescriptionFormat('', ALLEGRO)).toBe('');
    });

    it('should return an empty string when the input is whitespace only', () => {
      expect(applyDescriptionFormat('   \n  ', ALLEGRO)).toBe('');
    });

    it('should return an empty string when only disallowed tags carrying no text survive', () => {
      expect(applyDescriptionFormat('<div><span>   </span></div>', ALLEGRO)).toBe('');
    });
  });

  describe('rewrites run before the allowlist', () => {
    it('should convert strong to b rather than deleting the emphasis', () => {
      // The ordering decision: run the allowlist first and `strong` (which
      // Allegro rejects) would be dropped along with the operator's emphasis.
      expect(applyDescriptionFormat('<p>a <strong>bold</strong> word</p>', ALLEGRO)).toBe(
        '<p>a <b>bold</b> word</p>',
      );
    });

    it('should convert italic to b, keeping the emphasis visible but lossy', () => {
      expect(applyDescriptionFormat('<p><i>x</i> and <em>y</em></p>', ALLEGRO)).toBe(
        '<p><b>x</b> and <b>y</b></p>',
      );
    });

    it('should unwrap u, keeping its text', () => {
      expect(applyDescriptionFormat('<p>plain <u>underlined</u></p>', ALLEGRO)).toBe(
        '<p>plain underlined</p>',
      );
    });

    it('should convert br inside a paragraph into a paragraph break', () => {
      expect(applyDescriptionFormat('<p>first<br>second</p>', ALLEGRO)).toBe(
        '<p>first</p><p>second</p>',
      );
    });

    it('should normalize a self-closing br variant the same way', () => {
      expect(applyDescriptionFormat('<p>first<br />second</p>', ALLEGRO)).toBe(
        '<p>first</p><p>second</p>',
      );
    });

    it('should drop a br outside a paragraph rather than invent structure', () => {
      // Splitting a <li> would silently create a second bullet; splitting a
      // <ul> would end the list. Dropping loses a line break and nothing else.
      expect(applyDescriptionFormat('<ul><li>a<br>b</li></ul>', ALLEGRO)).toBe(
        '<ul><li>ab</li></ul>',
      );
    });

    it('should leave br alone on a format that allows it', () => {
      expect(applyDescriptionFormat('<p>first<br>second</p>', ERLI)).toBe(
        '<p>first<br/>second</p>',
      );
    });
  });

  describe('tag allowlist', () => {
    it('should unwrap a disallowed tag and keep its text', () => {
      expect(applyDescriptionFormat('<p>keep <span>this</span></p>', ALLEGRO)).toBe(
        '<p>keep this</p>',
      );
    });

    it('should drop a table and keep the cell text', () => {
      const out = applyDescriptionFormat(
        '<p>a</p><table><tbody><tr><td>Weight</td><td>620 g</td></tr></tbody></table>',
        ALLEGRO,
      );
      expect(out).not.toContain('<table');
      expect(out).toContain('Weight');
      expect(out).toContain('620 g');
    });

    it('should drop a script element and keep no executable content', () => {
      // NOT the security boundary (that is the inbound parser, #2198), but the
      // shaping pass must not pass one through either.
      const out = applyDescriptionFormat('<p>ok</p><script>alert(1)</script>', ALLEGRO);
      expect(out).not.toContain('<script');
      expect(out).not.toContain('</script');
    });

    it('should discard a close tag whose open tag was dropped', () => {
      expect(applyDescriptionFormat('<p>a</div>b</p>', ALLEGRO)).toBe('<p>ab</p>');
    });

    it('should be case-insensitive about tag names', () => {
      expect(applyDescriptionFormat('<P>a <B>b</B></P>', ALLEGRO)).toBe('<p>a <b>b</b></p>');
    });
  });

  describe('attributes', () => {
    it('should strip every attribute when the format allows none', () => {
      expect(
        applyDescriptionFormat('<p style="color:#c00" class="rte">x</p>', ALLEGRO),
      ).toBe('<p>x</p>');
    });

    it('should keep an allowed attribute on the tag that allows it', () => {
      expect(
        applyDescriptionFormat('<p><a href="https://x.example" target="_blank">t</a></p>', SHOP),
      ).toBe('<p><a href="https://x.example">t</a></p>');
    });

    it('should drop a javascript: URL even on an allowed attribute', () => {
      expect(applyDescriptionFormat('<p><a href="javascript:alert(1)">t</a></p>', SHOP)).toBe(
        '<p><a>t</a></p>',
      );
    });
  });

  describe('content model', () => {
    it('should strip formatting inside a heading that accepts none', () => {
      // The rule a flat allowlist provably cannot express, and the shape
      // PrestaShop TinyMCE really produces.
      expect(applyDescriptionFormat('<h1><b>Title</b></h1>', ALLEGRO)).toBe('<h1>Title</h1>');
    });

    it('should strip formatting inside h3 on a format that allows h3', () => {
      expect(applyDescriptionFormat('<h3><strong>T</strong></h3>', ERLI)).toBe('<h3>T</h3>');
    });

    it('should drop a block that is not allowed at the root, keeping its text', () => {
      expect(applyDescriptionFormat('<li>orphan</li>', ALLEGRO)).toBe('<p>orphan</p>');
    });

    it('should keep p inside li where the model allows it', () => {
      expect(applyDescriptionFormat('<ul><li><p>x</p></li></ul>', ALLEGRO)).toBe(
        '<ul><li><p>x</p></li></ul>',
      );
    });

    it('should apply the flat allowlist only when no content model is declared', () => {
      expect(applyDescriptionFormat('<h1><strong>T</strong></h1>', SHOP)).toBe(
        '<h1><strong>T</strong></h1>',
      );
    });
  });

  describe('block opener', () => {
    it('should wrap inline-only output in a paragraph', () => {
      expect(applyDescriptionFormat('<b>bold</b>', ALLEGRO)).toBe('<p><b>bold</b></p>');
    });

    it('should wrap bare text in a paragraph', () => {
      expect(applyDescriptionFormat('just text', ALLEGRO)).toBe('<p>just text</p>');
    });

    it('should not wrap output that already opens with a block tag', () => {
      expect(applyDescriptionFormat('<h1>t</h1><p>b</p>', ALLEGRO)).toBe('<h1>t</h1><p>b</p>');
    });

    it('should not wrap when the format does not require an opener', () => {
      expect(applyDescriptionFormat('<b>bold</b>', SHOP)).toBe('<b>bold</b>');
    });

    it('should wrap loose text left AFTER a block, not only a leading run', () => {
      // Regression: a dropped <table> leaves its cell text at the root after
      // the blocks. Wrapping only the leading run produced
      // `<h1>T</h1><p>a</p>c`, which a root set excluding text rejects - and it
      // reads as correct in review. Caught by the Allegro adapter's spec.
      expect(
        applyDescriptionFormat('<h1>T</h1><p>a</p><table><tr><td>c</td></tr></table>', ALLEGRO),
      ).toBe('<h1>T</h1><p>a</p><p>c</p>');
    });

    it('should wrap loose text between two blocks', () => {
      expect(applyDescriptionFormat('<p>a</p>loose<p>b</p>', ALLEGRO)).toBe(
        '<p>a</p><p>loose</p><p>b</p>',
      );
    });

    it('should not nest a block inside the implicit wrapper', () => {
      const out = applyDescriptionFormat('<b>a</b><p>c</p>', ALLEGRO);
      expect(out).toBe('<p><b>a</b></p><p>c</p>');
      expect(out).not.toContain('<p><b>a</b><p>');
    });
  });

  describe('void spelling', () => {
    it('should emit a self-closing br when the format requires it', () => {
      expect(applyDescriptionFormat('<p>a<br>b</p>', ERLI)).toContain('<br/>');
    });

    it('should emit a bare br when the format does not require self-closing', () => {
      const out = applyDescriptionFormat('<p>a<br>b</p>', SHOP);
      expect(out).toContain('<br>');
      expect(out).not.toContain('<br/>');
    });
  });

  /** Every emitted element is closed, innermost-first, with no stray close tag. */
  function isBalanced(html: string): boolean {
    const voids = new Set(['br', 'hr', 'img', 'wbr']);
    const stack: string[] = [];
    const pattern = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/)?\s*>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const tag = match[2].toLowerCase();
      if (voids.has(tag) || match[3] === '/') continue;
      if (match[1] === '/') {
        if (stack.pop() !== tag) return false;
      } else {
        stack.push(tag);
      }
    }
    return stack.length === 0;
  }

  describe('byte cap', () => {
    it('should leave output under the cap untouched', () => {
      expect(applyDescriptionFormat('<p>short</p>', { ...ALLEGRO, maxBytes: 1000 })).toBe(
        '<p>short</p>',
      );
    });

    it('should close every element it cut through, not merely end on a tag', () => {
      // The previous implementation cut at the last '>' inside the budget, which
      // keeps a half-written TAG off the wire and happily ships a half-closed
      // ELEMENT: a 40-byte budget produced literally `<h1>Title</h1><p>`. An
      // `endsWith('>')` assertion passes on that, which is why it is not the
      // assertion here - balance is.
      const long = `<h1>Title</h1><p>${'x'.repeat(300)}</p>`;
      const out = applyDescriptionFormat(long, { ...ALLEGRO, maxBytes: 40 });
      expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(40);
      expect(isBalanced(out)).toBe(true);
      expect(out).toContain('Title');
    });

    it('should close a single element the cut landed inside', () => {
      const out = applyDescriptionFormat(`<p>${'x'.repeat(300)}</p><p>tail</p>`, {
        ...ALLEGRO,
        maxBytes: 50,
      });
      expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(50);
      expect(isBalanced(out)).toBe(true);
      expect(out.startsWith('<p>x')).toBe(true);
    });

    it('should cut at a tag boundary so a half-open tag never ships', () => {
      const long = `<p>${'x'.repeat(200)}</p><p>tail</p>`;
      const out = applyDescriptionFormat(long, { ...ALLEGRO, maxBytes: 120 });
      expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(120);
      expect(out.endsWith('>')).toBe(true);
      expect(isBalanced(out)).toBe(true);
    });

    it('should never emit a lone surrogate when the cut lands on an astral character', () => {
      // Indexing by UTF-16 unit split the emoji and shipped `"aaa\ud83d"`, which
      // is invalid UTF-8 and does not survive JSON serialisation.
      const out = applyDescriptionFormat('aaa\u{1F600}bbb', {
        ...ALLEGRO,
        shape: 'plain-text',
        maxBytes: 8,
      });
      expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(8);
      expect(out).toBe('aaa\u{1F600}b');
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(
        false,
      );
    });

    it('should count bytes and not characters, so multi-byte text is capped correctly', () => {
      const multiByte = `<p>${'ż'.repeat(100)}</p>`;
      const out = applyDescriptionFormat(multiByte, { ...ALLEGRO, maxBytes: 60 });
      expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(60);
    });

    it('should not cap when the format declares no maximum', () => {
      const long = `<p>${'x'.repeat(5000)}</p>`;
      expect(applyDescriptionFormat(long, { ...SHOP, maxBytes: null })).toBe(long);
    });
  });

  describe('plain-text destinations', () => {
    it('should strip every tag and collapse whitespace', () => {
      expect(
        applyDescriptionFormat('<p>a</p>\n<p>b</p>', { ...ALLEGRO, shape: 'plain-text' }),
      ).toBe('a b');
    });
  });

  describe('empty-element collapse', () => {
    it('should remove an element left empty by the pass', () => {
      expect(applyDescriptionFormat('<p><u></u></p><p>real</p>', ALLEGRO)).toBe('<p>real</p>');
    });

    it('should still recognise an empty element whose attribute value contains a bracket', () => {
      // Unreachable through any shipped format, whose attribute allowlists are
      // href-only - but a `>` inside an attribute value is exactly what a
      // free-form allowlist (`title`, `alt`) would let through, and the collapse
      // has to keep working when someone widens one.
      const titled: DescriptionFormat = {
        ...SHOP,
        allowedAttributes: { a: ['href', 'title'] },
      };

      expect(applyDescriptionFormat('<p><a title="a > b"></a></p><p>real</p>', titled)).toBe(
        '<p>real</p>',
      );
    });
  });

  describe('real PrestaShop TinyMCE markup, end to end', () => {
    const TINYMCE = [
      '<div class="rte" style="font-family:Verdana">',
      '<h1><strong>Kurtka puchowa Alpine 300</strong></h1>',
      '<p style="margin:0 0 12px">Utrzymuje ciepło do <span style="font-weight:700">-20 °C</span>.<br>Waga 620 g.</p>',
      '<table border="1"><tbody><tr><td>Waga</td><td>620 g</td></tr></tbody></table>',
      '<p><a href="https://sklep.example/rozmiary" target="_blank">Tabela rozmiarów</a></p>',
      '<ul><li>Puch 90/10, 300 g</li><li>Membrana 10 000 mm</li></ul>',
      '</div>',
    ].join('');

    it('should produce an Allegro-legal payload', () => {
      const out = applyDescriptionFormat(TINYMCE, ALLEGRO);

      // Every tag Allegro rejects is gone.
      for (const rejected of ['<div', '<span', '<table', '<tbody', '<tr', '<td', '<a', '<br', '<strong']) {
        expect(out).not.toContain(rejected);
      }
      // No attributes survive.
      expect(out).not.toMatch(/<[a-z0-9]+\s+[a-z-]+=/i);
      // Opens with a block tag.
      expect(out).toMatch(/^<(p|h1|h2|ul|ol)\b/);
      // The heading kept its text but lost its formatting.
      expect(out).toContain('<h1>Kurtka puchowa Alpine 300</h1>');
      // The list survived intact.
      expect(out).toContain('<li>Puch 90/10, 300 g</li>');
      // The link's text survived even though the anchor did not.
      expect(out).toContain('Tabela rozmiarów');
      // The <br> became a paragraph break.
      expect(out).toContain('</p><p>Waga 620 g.');
    });

    it('should produce an Erli payload that keeps a self-closing br', () => {
      const out = applyDescriptionFormat(TINYMCE, ERLI);
      expect(out).toContain('<br/>');
      expect(out).not.toContain('<br>');
      expect(out).not.toContain('<table');
      expect(out).not.toContain('<a ');
      expect(out).toContain('<h1>Kurtka puchowa Alpine 300</h1>');
    });

    it('should keep the link and the emphasis on a permissive shop', () => {
      const out = applyDescriptionFormat(TINYMCE, SHOP);
      expect(out).toContain('<a href="https://sklep.example/rozmiary">');
      expect(out).toContain('<strong>');
      expect(out).not.toContain('<table');
      expect(out).not.toContain('style=');
    });
  });

  describe('comments, CDATA and doctypes are markup, not text', () => {
    it('should drop a Gutenberg block comment rather than wrap it in a paragraph', () => {
      // `TAG_PATTERN` requires `<[a-zA-Z]`, so these used to survive as TEXT and
      // then get wrapped: `<p>a</p><p><!-- wp:paragraph --></p><p>b</p>`. Fully
      // reachable - the builders read the description from a LIVE master call
      // that never passes through `sanitizeStoredHtml`, and a WooCommerce
      // `post_content` carries these as a matter of course.
      expect(
        applyDescriptionFormat('<p>a</p><!-- wp:paragraph --><p>b</p>', ALLEGRO),
      ).toBe('<p>a</p><p>b</p>');
    });

    it('should drop a CDATA section', () => {
      expect(applyDescriptionFormat('<p>a</p><![CDATA[x]]>', ALLEGRO)).toBe('<p>a</p>');
    });

    it('should drop a doctype and a processing instruction', () => {
      expect(applyDescriptionFormat('<!DOCTYPE html><p>a</p><?xml v?>', ALLEGRO)).toBe('<p>a</p>');
    });
  });

  describe('a block inside an inline element', () => {
    it('should drop the block and keep its text, rather than cross-nesting', () => {
      // Was `<p><b>a</p><p>c</p><p></b></p>` - cross-nested, with a stray close
      // tag. `sanitize-html` does NOT re-balance block-in-inline, so nothing
      // upstream fixes this, and the adapter keeps no defensive second pass.
      expect(applyDescriptionFormat('<strong>a<p>c</p></strong>', ALLEGRO)).toBe(
        '<p><b>ac</b></p>',
      );
    });

    it('should not leave a bare list item behind when it drops the list', () => {
      // `<li>` outside a list is structurally meaningless; judging an unmodelled
      // parent as an inline context rejects it while keeping the text.
      expect(applyDescriptionFormat('<b>a<ul><li>x</li></ul></b>', ALLEGRO)).toBe(
        '<p><b>ax</b></p>',
      );
    });
  });

  describe('malformed input degrades predictably', () => {
    it('should close a tag the input left open', () => {
      expect(applyDescriptionFormat('<p>unclosed', ALLEGRO)).toBe('<p>unclosed</p>');
    });

    it('should not throw on interleaved tags', () => {
      expect(() => applyDescriptionFormat('<p><b>a</p></b>', ALLEGRO)).not.toThrow();
    });

    it('should be idempotent: applying the format twice changes nothing', () => {
      const once = applyDescriptionFormat(TINYMCE_FOR_IDEMPOTENCE, ALLEGRO);
      expect(applyDescriptionFormat(once, ALLEGRO)).toBe(once);
    });
  });
});

const TINYMCE_FOR_IDEMPOTENCE =
  '<div><h1><b>T</b></h1><p>a<br>b</p><ul><li>x</li></ul></div>';
