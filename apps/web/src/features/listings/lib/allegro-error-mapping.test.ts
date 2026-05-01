/**
 * Allegro Error Mapping Tests
 *
 * Coverage per #448 acceptance: one assertion per mapped code, two for
 * `UnknownJSONProperty` (with and without `error.field`), one for the
 * fallback. Table-driven for the static codes; explicit `it()` blocks for
 * the field-aware code so the with/without-field branches read clearly.
 *
 * @module apps/web/src/features/listings/lib
 */
import { describe, expect, it } from 'vitest';
import { translateAllegroError } from './allegro-error-mapping';
import type { OfferCreationError } from '../api/listings.types';

describe('translateAllegroError', () => {
  it.each([
    [
      'SAFETY_INFO_NOT_DEFINED',
      /verify the discriminator/i,
    ],
    [
      'NO_SAFETY_INFORMATION_OPTION_NOT_ALLOWED',
      /Provide safety information \(text\)/,
    ],
    [
      'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
      /Responsible Producer/,
    ],
    [
      'UnsupportedLanguageInAcceptLanguageHeader',
      /unsupported Accept-Language/,
    ],
  ])('translates %s into an operator-actionable message', (code, expected) => {
    const result = translateAllegroError({
      code,
      message: 'Allegro raw message',
    });
    expect(result).not.toBeNull();
    expect(result?.message).toMatch(expected);
  });

  it('interpolates the field path into the UnknownJSONProperty message when present', () => {
    const result = translateAllegroError({
      code: 'UnknownJSONProperty',
      field: 'safetyInformation.foo',
      message: 'Unknown properties found in the request',
    });
    expect(result?.message).toContain('`safetyInformation.foo`');
    expect(result?.message).toMatch(/regression in the OL Allegro adapter/);
  });

  it('omits the path clause from the UnknownJSONProperty message when field is absent', () => {
    const result = translateAllegroError({
      code: 'UnknownJSONProperty',
      message: 'Unknown properties found in the request',
    });
    expect(result?.message).not.toContain('at `');
    expect(result?.message).toMatch(/regression in the OL Allegro adapter/);
  });

  it('returns null for codes that are not in the allowlist', () => {
    const error: OfferCreationError = {
      code: 'SOME_NEW_ALLEGRO_CODE_WE_HAVE_NOT_SEEN_YET',
      message: 'Whatever Allegro said.',
    };
    expect(translateAllegroError(error)).toBeNull();
  });

  it.each(['toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'returns null for prototype-inherited key %s (defensive — never resolves to an Object.prototype method)',
    (code) => {
      expect(translateAllegroError({ code, message: 'irrelevant' })).toBeNull();
    },
  );
});
