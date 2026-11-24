/**
 * Mirakl Offer Description Policy
 *
 * Which `product_description` from OF21 may become a product description
 * (#4284). On Empik staging some cards return only the stylesheet of the
 * card's page, cut at about 2000 characters (`#empilp-z { max-width: ... }`),
 * with no text at all; Empik ends the cut with the next selector and `....`.
 * Copied as is, that would be published to a shop or a marketplace as the
 * product's description, so a description made only of CSS rules (a cut-off
 * last rule or a trailing bare selector included) is read as no description.
 *
 * Anything with text outside the rules, HTML with a `<style>` block among
 * them, is kept: sanitising it is the inbound HTML pass's job, not this one.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_RULE = /[^{}]*\{[^{}]*\}/g;
const CUT_OFF_CSS_RULE = /[^{}]*\{[^{}]*$/;
/** A selector with no rule body, then the ellipsis Empik cuts with (`#a .b ....`). */
const TRAILING_SELECTOR = /^\s*[#.*][\w\-#.:>*+~,[\]=()"'\s]*?(?:\.{3,}|\u2026)?\s*$/;

/** The offer's description, or `null` when it is blank or only CSS. */
export function readMiraklOfferDescription(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) {
    return null;
  }
  return isStylesheetOnly(text) ? null : text;
}

/** True when the text is CSS rules and nothing else. */
export function isStylesheetOnly(text: string): boolean {
  if (!text.includes('{')) {
    return false;
  }
  let rest = text.replace(CSS_COMMENT, '');
  let previous: string;
  do {
    previous = rest;
    rest = rest.replace(CSS_RULE, '');
  } while (rest !== previous);
  const leftover = rest.replace(CUT_OFF_CSS_RULE, '');
  return leftover.trim() === '' || TRAILING_SELECTOR.test(leftover);
}
