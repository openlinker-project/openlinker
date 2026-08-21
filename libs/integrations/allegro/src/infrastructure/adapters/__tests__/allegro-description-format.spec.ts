/**
 * Allegro Description Format - declaration
 *
 * Pins the EXACT tag set this adapter declares (ADR-046). The set is not a
 * style preference: on Allegro it is reconstructed from validator rejection
 * messages and on Erli it is published, so widening it without new evidence
 * is how the previous implementation ended up emitting five rejected tags.
 * These assertions make any widening a deliberate test change.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { applyDescriptionFormat } from '@openlinker/core/listings';

import { ALLEGRO_DESCRIPTION_FORMAT } from '../../util/allegro-description-format';

describe('Allegro description format', () => {
  it('should declare exactly the seven tags Allegro accepts', () => {
    expect([...ALLEGRO_DESCRIPTION_FORMAT.allowedTags].sort()).toEqual(
      ['b', 'h1', 'h2', 'li', 'ol', 'p', 'ul'].sort(),
    );
  });

  it('should declare no attributes at all', () => {
    expect(ALLEGRO_DESCRIPTION_FORMAT.allowedAttributes).toEqual({});
  });

  it('should not admit any tag Allegro is known to reject', () => {
    // #11708 (br), #9714 (strong), plus em/i/u/div/span.
    for (const rejected of ['strong', 'em', 'i', 'u', 'br', 'div', 'span', 'sup', 'sub']) {
      expect(ALLEGRO_DESCRIPTION_FORMAT.allowedTags).not.toContain(rejected);
    }
  });

  it('should allow no formatting inside a heading (#3856)', () => {
    expect(ALLEGRO_DESCRIPTION_FORMAT.contentModel?.h1).toEqual([]);
    expect(ALLEGRO_DESCRIPTION_FORMAT.contentModel?.h2).toEqual([]);
  });

  it('should convert br to a paragraph break rather than dropping it', () => {
    expect(ALLEGRO_DESCRIPTION_FORMAT.rewrites).toEqual(
      expect.arrayContaining([{ from: 'br', action: 'split-block' }]),
    );
  });

  it('should cap at the documented 40 000 bytes', () => {
    expect(ALLEGRO_DESCRIPTION_FORMAT.maxBytes).toBe(40_000);
  });

  it('should produce an Allegro-legal payload from PrestaShop TinyMCE markup', () => {
    const out = applyDescriptionFormat(
      '<div class="rte"><h1><strong>T</strong></h1><p>a<br>b</p><table><tr><td>c</td></tr></table></div>',
      ALLEGRO_DESCRIPTION_FORMAT,
    );
    expect(out).toBe('<h1>T</h1><p>a</p><p>b</p><p>c</p>');
  });
});
