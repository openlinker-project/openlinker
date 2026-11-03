/**
 * Unit tests for the PrestaShop order-state semantics (#2607 review)
 *
 * The label half of this rule is the fragile half, so these tests are a table
 * over the languages PrestaShop ships. The case that matters is a
 * SINGLE-language shop: a multi-language row usually carries English too, which
 * hides a missing translation.
 */
import type { PrestashopOrderState } from '../../../domain/types/prestashop-options.types';
import {
  MIN_STEM_LENGTH,
  ORDER_STATE_LABEL_STEMS,
  deriveOrderState,
  deriveOrderStatusFromState,
  toLabelWords,
} from '../prestashop-order-state-semantics';

/** A single-language shop: one flat label, no flag set. */
function singleLanguageState(name: string): PrestashopOrderState {
  return {
    id: '20',
    name,
    deleted: '0',
    paid: '0',
    shipped: '0',
    delivery: '0',
    logable: '0',
  };
}

describe('deriveOrderStatusFromState - cancellation labels', () => {
  it.each([
    ['en', 'Canceled'],
    ['en', 'Cancelled'],
    ['fr', 'Annulé'],
    ['es', 'Cancelado'],
    ['es', 'Anulado'],
    ['it', 'Annullato'],
    ['pt', 'Cancelado'],
    ['pl', 'Anulowano'],
    ['ro', 'Anulat'],
    ['de', 'Storniert'],
    ['de', 'Abgebrochen'],
    ['nl', 'Geannuleerd'],
    ['cs', 'Storno'],
    ['sk', 'Zrušené'],
    ['sv', 'Avbruten'],
    ['fi', 'Peruutettu'],
    ['tr', 'İptal edildi'],
    ['hr', 'Anulirano'],
  ])('reads a %s cancellation state ("%s") as cancelled', (_lang, label) => {
    expect(deriveOrderStatusFromState(singleLanguageState(label))).toBe('cancelled');
  });
});

describe('deriveOrderStatusFromState - refund labels', () => {
  it.each([
    ['en', 'Refunded'],
    ['fr', 'Remboursé'],
    ['es', 'Reembolsado'],
    ['it', 'Rimborsato'],
    ['pt', 'Reembolsado'],
    ['pl', 'Zwrócono'],
    ['pl', 'Zwrot'],
    ['de', 'Erstattet'],
    ['de', 'Rückerstattet'],
    ['nl', 'Terugbetaald'],
    ['cs', 'Vráceno'],
    ['sk', 'Vrátené'],
    ['sv', 'Återbetald'],
    ['fi', 'Hyvitetty'],
    ['ro', 'Rambursat'],
    ['hu', 'Visszatérítve'],
    ['lt', 'Grąžinta'],
    ['lv', 'Atmaksāts'],
  ])('reads a %s refund state ("%s") as refunded', (_lang, label) => {
    expect(deriveOrderStatusFromState(singleLanguageState(label))).toBe('refunded');
  });
});

describe('deriveOrderStatusFromState - words the old fragments matched wrongly', () => {
  it.each([
    // The reason stems are whole-word and at least five characters: `abge`
    // matched both of these, so a finished order read as cancelled.
    ['Abgeschlossen'],
    ['Abgesendet'],
    // `anul` would match this; the vocabulary uses the longer endings instead.
    ['Granulat handling'],
  ])('does not read "%s" as cancelled', (label) => {
    expect(deriveOrderStatusFromState(singleLanguageState(label))).not.toBe('cancelled');
  });

  it('reads the German "Storniert" as a cancellation, not a refund', () => {
    // It sat in the refund vocabulary, so a German shop naming its
    // cancellation state this way emitted a refund and never a cancellation.
    expect(deriveOrderStatusFromState(singleLanguageState('Storniert'))).toBe('cancelled');
  });
});

describe('deriveOrderState - basis', () => {
  it('reports the flag that answered', () => {
    expect(deriveOrderState({ ...singleLanguageState('Shipped'), shipped: '1' }).basis).toBe(
      'shipped-flag'
    );
    expect(deriveOrderState({ ...singleLanguageState('Delivered'), shipped: '1' }).basis).toBe(
      'delivered-label'
    );
    expect(deriveOrderState({ ...singleLanguageState('Paid, picking'), paid: '1' }).basis).toBe(
      'paid-flag'
    );
  });

  it('reports no-evidence for a state nothing could be read from', () => {
    // `pending` here is a default, not a reading, and the catalogue says so out
    // loud rather than letting a possibly-refunded state pass as untouched.
    const derived = deriveOrderState(singleLanguageState('Wachten op koerier'));

    expect(derived).toEqual({ status: 'pending', basis: 'no-evidence' });
  });

  it('reports the label that answered ahead of the paid flag', () => {
    expect(deriveOrderState(singleLanguageState('Zwrócono')).basis).toBe('refund-label');
    expect(deriveOrderState(singleLanguageState('Anulowano')).basis).toBe('cancel-label');
  });
});

/**
 * The real PrestaShop 9.0.2 rows (#3506, G02-7), flags exactly as
 * `install/data/xml/order_state.xml` ships them. `delivery` is `1` on 3, 4 AND
 * 5, and 4 and 5 carry identical flags, so the label is the only discriminator.
 */
describe('deriveOrderState - PrestaShop 9 default states (#3506)', () => {
  const ps9 = (id: string, name: string, flags: Partial<PrestashopOrderState>) =>
    ({ id, name, deleted: '0', logable: '1', ...flags }) as PrestashopOrderState;

  it('should read state 5 "Delivered" as delivered when shipped and delivery are both set', () => {
    expect(deriveOrderState(ps9('5', 'Delivered', { paid: '1', shipped: '1', delivery: '1' }))).toEqual(
      { status: 'delivered', basis: 'delivered-label' }
    );
  });

  it('should read state 4 "Shipped" as shipped when its flags equal the delivered state', () => {
    expect(deriveOrderStatusFromState(ps9('4', 'Shipped', { paid: '1', shipped: '1', delivery: '1' }))).toBe(
      'shipped'
    );
  });

  it('should read state 3 "Processing in progress" as processing when only delivery and paid are set', () => {
    expect(
      deriveOrderStatusFromState(
        ps9('3', 'Processing in progress', { paid: '1', shipped: '0', delivery: '1' })
      )
    ).toBe('processing');
  });
});

describe('deriveOrderStatusFromState - delivered labels (#3506)', () => {
  const shippedState = (name: string): PrestashopOrderState => ({
    ...singleLanguageState(name),
    paid: '1',
    shipped: '1',
  });

  it.each([
    ['en', 'Delivered'],
    ['pl', 'Dostarczone'],
    ['pl', 'Doręczono'],
    ['de', 'Zugestellt'],
    ['de', 'Ausgeliefert'],
    ['fr', 'Livré'],
    ['es', 'Entregado'],
    ['pt', 'Entregue'],
    ['it', 'Consegnato'],
    ['nl', 'Bezorgd'],
    ['cs', 'Doručeno'],
    ['sv', 'Levererad'],
    ['hu', 'Kézbesítve'],
  ])('should read a shipped %s state ("%s") as delivered', (_lang, label) => {
    expect(deriveOrderStatusFromState(shippedState(label))).toBe('delivered');
  });

  it.each([
    ['Out for delivery'],
    ['W doręczeniu'],
    ['Entregando'],
    ['Doručuje se'],
    ['In consegna'],
  ])('should read the in-flight label "%s" as shipped, not delivered', (label) => {
    expect(deriveOrderStatusFromState(shippedState(label))).toBe('shipped');
  });

  it.each([['Not delivered'], ['Nie dostarczono'], ['No entregado'], ['Partially delivered']])(
    'should refuse a delivered reading when the label "%s" negates or qualifies it',
    (label) => {
      expect(deriveOrderStatusFromState(shippedState(label))).toBe('shipped');
    }
  );

  it('should not read delivered from a delivered label on a state that never shipped', () => {
    expect(deriveOrderStatusFromState({ ...singleLanguageState('Delivered'), paid: '1' })).toBe(
      'processing'
    );
  });

  it('should not read delivered from the delivery flag alone', () => {
    expect(
      deriveOrderStatusFromState({ ...singleLanguageState('Shipped'), shipped: '1', delivery: '1' })
    ).toBe('shipped');
  });
});

describe('toLabelWords', () => {
  it('folds diacritics and splits on everything that is not a letter or digit', () => {
    expect(toLabelWords('İptal edildi (2)')).toEqual(['iptal', 'edildi', '2']);
    expect(toLabelWords('Rückerstattet/Storniert')).toEqual(['ruckerstattet', 'storniert']);
  });
});

describe('the stem vocabulary', () => {
  it('has no stem shorter than the minimum, so a fragment cannot be added quietly', () => {
    const tooShort = ORDER_STATE_LABEL_STEMS.filter((stem) => stem.length < MIN_STEM_LENGTH);

    expect(tooShort).toEqual([]);
  });

  it('holds every stem already folded and lowercased, or it could never match', () => {
    const unfolded = ORDER_STATE_LABEL_STEMS.filter((stem) => toLabelWords(stem)[0] !== stem);

    expect(unfolded).toEqual([]);
  });
});
