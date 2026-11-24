/**
 * Mirakl Offer Description Policy: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { isStylesheetOnly, readMiraklOfferDescription } from '../mirakl-offer-description.policy';

/** The shape Empik staging returned for OL-TEST-HP1 on 2026-11-24. */
const EMPIK_CARD_STYLES = ` \n\n#empilp-z {\n\tmax-width: 830px;\n\tmargin: 0 auto;\n}\n\n#empilp-z * {\n\tbox-sizing: border-box;\n}\n/* layout */\n#empilp-z .empilp-z-row {\n\tdisplay:flex;\n}\n#empilp-z .empilp-z-s7 {\n\tpadding: 10`;

describe('readMiraklOfferDescription', () => {
  it('should keep an HTML description', () => {
    expect(readMiraklOfferDescription('<p>Opis</p>')).toBe('<p>Opis</p>');
  });

  it('should keep plain text with braces in it', () => {
    expect(readMiraklOfferDescription('Zestaw {3 sztuki} w pudełku')).toBe(
      'Zestaw {3 sztuki} w pudełku'
    );
  });

  it('should keep HTML that carries a style block beside its text', () => {
    const html = '<style>.a { color: red; }</style><p>Opis książki</p>';

    expect(readMiraklOfferDescription(html)).toBe(html);
  });

  it('should read a description made only of CSS, cut off at the end, as none', () => {
    expect(readMiraklOfferDescription(EMPIK_CARD_STYLES)).toBeNull();
  });

  it('should read CSS that Empik cut at a bare selector and an ellipsis as none', () => {
    // How OL-TEST-HP1 actually ends on Empik staging (2026-11-24).
    const cut = '#empilp-z p {\n\tmargin-top: 20px;\n}\n\n#empilp-z .empilp-z-s7 ....';

    expect(readMiraklOfferDescription(cut)).toBeNull();
  });

  it('should keep ASCII prose that follows a braced part', () => {
    expect(readMiraklOfferDescription('Set {3 pieces} in a box')).toBe('Set {3 pieces} in a box');
  });

  it('should read a blank or absent description as none', () => {
    expect(readMiraklOfferDescription('   ')).toBeNull();
    expect(readMiraklOfferDescription(undefined)).toBeNull();
  });
});

describe('isStylesheetOnly', () => {
  it('should not flag text without any rule', () => {
    expect(isStylesheetOnly('Opis')).toBe(false);
  });

  it('should flag complete rules with comments between them', () => {
    expect(isStylesheetOnly('/* a */ .x { color: red; } .y { margin: 0 }')).toBe(true);
  });
});
