/**
 * Allegro offer-title length rule (client mirror)
 *
 * Allegro rejects an offer whose title exceeds 75 characters. The adapter
 * enforces that at build time (#1934/F11), but by then the operator has already
 * submitted the batch and the failure arrives per-record, minutes later. This
 * module is the pre-submit half of the same rule, consumed by
 * `allegroOfferValidation.validateRow` so the wizard flags the row before the
 * operator commits.
 *
 * The length is measured on the SANITIZED title, mirroring
 * `sanitizeAllegroName` in `@openlinker/integrations-allegro` — that util runs
 * on the wire path before the adapter's own check, and it can change the length
 * in both directions (whitespace collapse shortens; `…` → `...` and `—` → ` - `
 * expand by 2). Measuring the raw string would therefore both miss real
 * rejections and block titles that would have fit. The banned-char map is
 * duplicated here rather than imported because the browser bundle cannot reach
 * into an integration package; it is 7 entries and additive-only, and the
 * consequence of drift is a wrong client-side hint, never a wrong wire payload.
 *
 * @module features/listings/components/allegro
 */

/** Allegro's hard offer-title limit. Mirrors `ALLEGRO_OFFER_TITLE_MAX_LENGTH`. */
const ALLEGRO_OFFER_TITLE_MAX_LENGTH = 75;

/** Mirrors `BANNED_NAME_CHAR_MAP` (`libs/integrations/allegro`, #420). */
const BANNED_NAME_CHAR_MAP: Readonly<Record<string, string>> = {
  '—': ' - ',
  '–': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
};

/** Mirrors `sanitizeAllegroName` — substitute, collapse whitespace, trim. */
function sanitizeAllegroTitle(title: string): string {
  const substituted = [...title].map((ch) => BANNED_NAME_CHAR_MAP[ch] ?? ch).join('');
  return substituted.replace(/\s+/g, ' ').trim();
}

/** Whether the title would be rejected for length on the wire. */
export function isAllegroTitleTooLong(title: string): boolean {
  return sanitizeAllegroTitle(title).length > ALLEGRO_OFFER_TITLE_MAX_LENGTH;
}

/**
 * Allegro's floor: at least 12 characters and at least 3 space-separated words
 * (#2243). Measured on the same sanitized string as the ceiling above, so a
 * whitespace-collapsing title cannot read as long enough here and short on the
 * wire. A short master product name ("Fotel Ergo") reads ready in the wizard
 * today and is rejected after submit; this is the other half of that rule.
 */
const ALLEGRO_OFFER_TITLE_MIN_LENGTH = 12;
const ALLEGRO_OFFER_TITLE_MIN_WORDS = 3;

export function isAllegroTitleTooShort(title: string): boolean {
  const sanitized = sanitizeAllegroTitle(title);
  // An empty title is a different, already-reported condition (the row has no
  // title at all) - flagging it here would double-chip the same row.
  if (sanitized === '') return false;
  const words = sanitized.split(' ').filter((w) => w !== '');
  return (
    sanitized.length < ALLEGRO_OFFER_TITLE_MIN_LENGTH ||
    words.length < ALLEGRO_OFFER_TITLE_MIN_WORDS
  );
}
