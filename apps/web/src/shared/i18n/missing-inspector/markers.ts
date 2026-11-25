/**
 * Fallback markers
 *
 * Invisible wrapping the missing-translation inspector (#4017) puts around a
 * string that fell back to English: an open sequence carrying the registry
 * id, the string itself, a close sequence. Every character is zero-width and
 * outside the placeholder (`{name}`) and tag (`<b>`) syntax, so interpolation,
 * plural selection and `renderRich` treat a marked string like any other, and
 * a marked string interpolated into another keeps its own marker.
 *
 * @module shared/i18n/missing-inspector
 */

const OPEN_HEAD = '\u2063\u2062';
const OPEN_TAIL = '\u2064';
const CLOSE = '\u2063\u2061';
const DIGITS = ['\u200B', '\u200C', '\u200D', '\u2060'] as const;

const TOKEN = /\u2063\u2062([\u200B\u200C\u200D\u2060]+)\u2064|\u2063\u2061/g;
const ANY_MARKER = /\u2063[\u2061\u2062]/;

export type MarkerToken =
  | { readonly type: 'open'; readonly id: number; readonly index: number; readonly length: number }
  | { readonly type: 'close'; readonly index: number; readonly length: number };

function encodeId(id: number): string {
  if (!Number.isInteger(id) || id < 0) throw new Error(`invalid marker id ${id}`);
  let out = '';
  let rest = id;
  do {
    out = DIGITS[rest % DIGITS.length] + out;
    rest = Math.floor(rest / DIGITS.length);
  } while (rest > 0);
  return out;
}

function decodeId(digits: string): number {
  let id = 0;
  for (const char of digits) id = id * DIGITS.length + DIGITS.indexOf(char as (typeof DIGITS)[number]);
  return id;
}

export function encodeMarker(id: number, text: string): string {
  return `${OPEN_HEAD}${encodeId(id)}${OPEN_TAIL}${text}${CLOSE}`;
}

export function hasMarker(text: string): boolean {
  return ANY_MARKER.test(text);
}

/** Every open and close sequence in the text, in order. */
export function tokenizeMarkers(text: string): MarkerToken[] {
  if (!hasMarker(text)) return [];
  const tokens: MarkerToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    const digits = match[1];
    tokens.push(
      digits === undefined
        ? { type: 'close', index, length: match[0].length }
        : { type: 'open', id: decodeId(digits), index, length: match[0].length },
    );
  }
  return tokens;
}

/** The ids of every marker opened in the text, outermost first. */
export function markerIdsIn(text: string): number[] {
  const ids: number[] = [];
  for (const token of tokenizeMarkers(text)) {
    if (token.type === 'open' && !ids.includes(token.id)) ids.push(token.id);
  }
  return ids;
}

/** The text without any marker characters. */
export function stripMarkers(text: string): string {
  return hasMarker(text) ? text.replace(TOKEN, '') : text;
}
