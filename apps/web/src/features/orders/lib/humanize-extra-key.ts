/**
 * Humanize a provider regime-extras key
 *
 * Turns a vendor key such as `processingMode`, `fiscal_document_id` or
 * `FISCALDOCUMENTID` into a readable sentence-case label for the sales document
 * panel (#4065). The key is provider vocabulary, so it is only split and
 * cased, never translated. A key with no detectable word boundary (all one
 * case, no separator) is returned as-is: guessing word breaks inside
 * `FISCALDOCUMENTID` would invent words the provider never wrote.
 */
export function humanizeExtraKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === '') return key;

  const words = trimmed
    .replace(/[_\-.]+/g, ' ')
    // `fiscalDocument` -> `fiscal Document`, `posID` stays a run until a lower letter follows.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // `POSId` -> `POS Id`: an acronym followed by a capitalised word.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 1) {
    const [only] = words;
    // A single all-caps run (`POSID`) cannot be split safely, so it stays.
    return only === only.toUpperCase() ? only : capitalise(only.toLowerCase());
  }

  // In an all-caps key (`FISCAL_DOCUMENT_ID`) every word looks like an
  // acronym, so case carries no signal there and every word is sentence-cased.
  const allCaps = !/[a-z]/.test(trimmed);

  return words
    .map((word, index) => {
      // Acronyms keep their case; ordinary words are lower-cased so only the
      // first word carries a capital (sentence case).
      const isAcronym =
        !allCaps && word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
      if (isAcronym) return word;
      const lower = word.toLowerCase();
      return index === 0 ? capitalise(lower) : lower;
    })
    .join(' ');
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
