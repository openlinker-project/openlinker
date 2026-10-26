/**
 * Buyer Note Types
 *
 * The free-text message a buyer leaves for the seller at checkout (#3538), as an
 * order source reported it, plus the pure rules that coerce it off a raw source
 * value and move it in and out of the persisted column. Type and rules live
 * together per `engineering-standards.md` § "The pure-rule exception to types
 * only".
 *
 * ## Three states, never two
 *
 * Same discipline as the buyer tax id (#2599): a buyer who wrote nothing and a
 * source that could not be read are different facts, and an adapter must never
 * report "no note" for a field it did not read.
 *
 * - `undefined` - the source could not say (the adapter did not or could not
 *   read the field). Unknown.
 * - `null` - the source asserted the buyer left no note.
 * - a non-empty string - the note, verbatim.
 *
 * ## PII
 *
 * The text is free input and bypasses the address redaction path: it may carry
 * a phone number or a parcel locker. Under `OL_STORE_PII=false` the text is
 * therefore NOT persisted, while the boolean `hasBuyerNote` still is, so every
 * surface can say a note exists without keeping its content.
 *
 * @module libs/core/src/orders/domain/types
 */

/** A source-reported buyer note in one of its three states. */
export type BuyerNote = string | null | undefined;

/**
 * Coerce a raw source value into a note. A blank value is the default state of
 * an optional field, not a statement about the buyer, so it is `undefined`
 * (unknown) here. The asserted-none state (`null`) is reserved for an adapter
 * whose source always returns the field and so positively knows there is no
 * note; it writes `null` itself.
 */
export function readSourceBuyerNote(raw: string | null | undefined): BuyerNote {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decode a note a shop returned HTML-escaped (N-26): `<br>` variants become
 * newlines and the common named / numeric entities become their characters.
 * Shops (WooCommerce, PrestaShop) store the buyer's text through an HTML
 * sanitiser, so `Tom & Jerry` arrives as `Tom &amp; Jerry`; the UI renders the
 * note verbatim as text, so the decoding has to happen once, at ingestion. No
 * other markup is touched or stripped. Entities are decoded in a single pass,
 * so `&amp;lt;` yields `&lt;`, not `<`.
 */
export function decodeHtmlNoteText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
      if (body.startsWith('#')) {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return HTML_NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}

/** True only for a real note text; unknown and asserted-none are both `false`. */
export function hasBuyerNoteText(value: BuyerNote): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Encode the three states into the single nullable `order_records.buyerNote`
 * column: `NULL` = not asserted (or not stored), `''` = asserted none,
 * otherwise the text. A whitespace-only string encodes as `NULL`, matching
 * {@link readSourceBuyerNote}.
 */
export function encodeBuyerNoteColumn(value: BuyerNote): string | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Decode {@link encodeBuyerNoteColumn}. `undefined` for a NULL column. */
export function decodeBuyerNoteColumn(column: string | null | undefined): BuyerNote {
  if (column === null || column === undefined) {
    return undefined;
  }
  return column.length === 0 ? null : column;
}

/** The three states a LIST row can say about the note, text-free (#3538). */
export const BuyerNoteListStateValues = ['present', 'none', 'unknown'] as const;
export type BuyerNoteListState = (typeof BuyerNoteListStateValues)[number];

/**
 * Classify an order's note for the list. `present` is the denormalised flag;
 * otherwise the stored column decides: `''` is the source asserting none, a
 * NULL column is unknown. Under `OL_STORE_PII=false` no text is stored, so a
 * note-less row cannot tell none from unknown and reads `unknown` - a stated
 * limit, not a claim that the source said nothing.
 */
export function classifyBuyerNoteForList(
  hasBuyerNote: boolean,
  state: BuyerNote,
): BuyerNoteListState {
  if (hasBuyerNote) {
    return 'present';
  }
  return state === null ? 'none' : 'unknown';
}

/** The list preview is bounded so a long note never rides in a list payload. */
export const BUYER_NOTE_PREVIEW_MAX_CHARACTERS = 120;

/**
 * First non-empty line of the note, trimmed and cut to
 * {@link BUYER_NOTE_PREVIEW_MAX_CHARACTERS}. No ellipsis character is added: the
 * client truncates visually. `null` when no text is stored.
 */
export function buildBuyerNotePreview(state: BuyerNote): string | null {
  if (typeof state !== 'string') {
    return null;
  }
  const first = state
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (first === undefined) {
    return null;
  }
  return Array.from(first).slice(0, BUYER_NOTE_PREVIEW_MAX_CHARACTERS).join('');
}

/**
 * Normalise an address country to the persisted 2-letter column form, or `null`
 * when absent. Country is not PII and survives address redaction.
 */
export function normaliseCountryColumn(country: string | null | undefined): string | null {
  if (country === undefined || country === null) {
    return null;
  }
  const trimmed = country.trim().toUpperCase();
  return trimmed.length === 2 ? trimmed : null;
}
