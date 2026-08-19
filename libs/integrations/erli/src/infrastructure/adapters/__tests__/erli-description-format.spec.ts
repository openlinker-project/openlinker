/**
 * Erli Description Format - declaration
 *
 * Pins the EXACT tag set this adapter declares (ADR-046). The set is not a
 * style preference: on Allegro it is reconstructed from validator rejection
 * messages and on Erli it is published, so widening it without new evidence
 * is how the previous implementation ended up emitting five rejected tags.
 * These assertions make any widening a deliberate test change.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { applyDescriptionFormat } from '@openlinker/core/listings';

import { ERLI_DESCRIPTION_FORMAT } from '../erli-description-format';

describe('Erli description format', () => {
  it('should declare exactly the nine tags Erli documents', () => {
    expect([...ERLI_DESCRIPTION_FORMAT.allowedTags].sort()).toEqual(
      ['b', 'br', 'h1', 'h2', 'h3', 'li', 'ol', 'p', 'ul'].sort(),
    );
  });

  it('should allow h3, unlike Allegro', () => {
    expect(ERLI_DESCRIPTION_FORMAT.allowedTags).toContain('h3');
  });

  it('should require a self-closing br', () => {
    expect(ERLI_DESCRIPTION_FORMAT.selfClosingVoids).toBe(true);
    expect(applyDescriptionFormat('<p>a<br>b</p>', ERLI_DESCRIPTION_FORMAT)).toBe(
      '<p>a<br/>b</p>',
    );
  });

  it('should not rewrite br, since Erli accepts it', () => {
    const froms = (ERLI_DESCRIPTION_FORMAT.rewrites ?? []).map((r) => r.from);
    expect(froms).not.toContain('br');
  });

  it('should not admit sup or sub, which appear in neither allowlist', () => {
    expect(ERLI_DESCRIPTION_FORMAT.allowedTags).not.toContain('sup');
    expect(ERLI_DESCRIPTION_FORMAT.allowedTags).not.toContain('sub');
  });

  it('should allow no formatting inside any heading', () => {
    expect(ERLI_DESCRIPTION_FORMAT.contentModel?.h1).toEqual([]);
    expect(ERLI_DESCRIPTION_FORMAT.contentModel?.h2).toEqual([]);
    expect(ERLI_DESCRIPTION_FORMAT.contentModel?.h3).toEqual([]);
  });
});
