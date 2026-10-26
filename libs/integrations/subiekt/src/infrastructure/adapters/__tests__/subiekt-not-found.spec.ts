/**
 * The deletion verdict, on its own.
 *
 * `looksLikeSubiektNotFound` decides whether a bridge rejection means the
 * seller deleted a towar. A wrong `true` runs the #1599 chain and zeroes the
 * product's offers on every marketplace, and nothing puts them back without a
 * human. So the rule is tested where it lives, not only through two adapters.
 */
import { looksLikeSubiektNotFound } from '../subiekt-not-found';

describe('looksLikeSubiektNotFound', () => {
  describe('when the bridge supplies its machine-readable code', () => {
    it('reports a deletion for not_found', () => {
      expect(
        looksLikeSubiektNotFound({ code: 'not_found', reason: 'No product with symbol X.' }),
      ).toBe(true);
    });

    // The condition this function exists for: the bridge is UP and answering
    // its ordinary failure envelope, while Subiekt is not reachable behind it.
    it.each([
      ['sfera_error', 'COM session could not attach'],
      ['sfera_error', 'Subiekt GT client is open'],
      ['bad_request', 'symbol and nazwa are required'],
      ['sql_error', 'A network-related or instance-specific error occurred'],
    ])('does NOT report a deletion for %s', (code, reason) => {
      expect(looksLikeSubiektNotFound({ code, reason })).toBe(false);
    });

    // The code WINS over the sentence. A future bridge whose `sfera_error`
    // message happens to contain the words "not found" (a SQL error quoting a
    // missing object, say) must not be adjudicated a deletion.
    it('trusts the code even when the sentence looks like a deletion', () => {
      expect(
        looksLikeSubiektNotFound({ code: 'sfera_error', reason: 'Object not found in database' }),
      ).toBe(false);
    });
  });

  describe('when the code is absent (a bridge older than the structured envelope)', () => {
    it.each([
      'Towar nie znaleziono lub usunięty: WIDGET-1',
      'No product with symbol WIDGET-1.',
      'No model with id 5.',
      'Produkt nie istnieje',
    ])('falls back to the sentence for %s', (reason) => {
      expect(looksLikeSubiektNotFound({ reason })).toBe(true);
    });

    it('fails CLOSED on a sentence it does not recognise', () => {
      expect(looksLikeSubiektNotFound({ reason: 'COM session could not attach' })).toBe(false);
      expect(looksLikeSubiektNotFound({ reason: '' })).toBe(false);
      expect(looksLikeSubiektNotFound({ reason: '[object Object]' })).toBe(false);
    });
  });

  // The two endpoints answer in two languages. The inventory one has always
  // answered in Polish and the catalogue one in English, so the regex the
  // inventory adapter carried alone could never have matched a catalogue
  // deletion - which is why the code, written once per endpoint, is the rule.
  it('covers both endpoints, whichever language they answer in', () => {
    expect(
      looksLikeSubiektNotFound({ code: 'not_found', reason: 'Towar nie znaleziono lub usunięty: X' }),
    ).toBe(true);
    expect(
      looksLikeSubiektNotFound({ code: 'not_found', reason: 'No product with symbol X.' }),
    ).toBe(true);
  });
});
