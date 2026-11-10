import {
  DEFAULT_GIFT_LINE_FORM,
  GiftDocumentFormChoiceValues,
  isGiftUnitPriceAmount,
  offeredGiftLineForms,
  presentGiftLines,
  readGiftConnectionForm,
  readGiftConnectionUnitPrice,
  readGiftDocumentSettings,
  resolveGiftPresentationFields,
  resolveGiftDocumentForm,
  validateGiftOnDocumentsShape,
  type GiftLineForm,
  type GiftPresentationLine,
} from './gift-lines.types';

const line = (
  over: Partial<GiftPresentationLine> & { name?: string },
): GiftPresentationLine & { name: string } => ({
  name: 'Item',
  quantity: 1,
  unitPriceGross: 10,
  taxRate: '23',
  ...over,
});

const gift = (over: Partial<GiftPresentationLine> & { name?: string } = {}) =>
  line({ name: 'Gift', unitPriceGross: 0, isGift: true, ...over });

const total = (lines: readonly { quantity: number; unitPriceGross: number }[]): number =>
  lines.reduce((n, l) => n + l.quantity * Math.round(l.unitPriceGross * 100), 0);

describe('resolveGiftDocumentForm', () => {
  it('should prefer the gift own form over the connection and the default', () => {
    expect(resolveGiftDocumentForm('omit', 'priced-in', 'show-zero')).toEqual({
      form: 'omit',
      source: 'rule',
    });
  });

  it('should use the connection override when the gift names no form', () => {
    expect(resolveGiftDocumentForm(undefined, 'priced-in', 'omit')).toEqual({
      form: 'priced-in',
      source: 'connection',
    });
  });

  it('should use the OpenLinker default, and technical-cent when nothing is saved', () => {
    expect(resolveGiftDocumentForm(undefined, undefined, 'omit')).toEqual({
      form: 'omit',
      source: 'default',
    });
    expect(resolveGiftDocumentForm(undefined, undefined, undefined)).toEqual({
      form: 'technical-cent',
      source: 'default',
    });
  });

  it('should read an unrecognised value at a level as absent', () => {
    expect(resolveGiftDocumentForm('free', 'nope', 'priced-in').source).toBe('default');
  });
});

describe('connection override', () => {
  it('should inherit when absent or unrecognised', () => {
    expect(readGiftConnectionForm(null)).toBeUndefined();
    expect(readGiftConnectionForm({})).toBeUndefined();
    expect(readGiftConnectionForm({ giftOnDocuments: { form: 'nonsense' } })).toBeUndefined();
    expect(readGiftConnectionForm({ giftOnDocuments: {} })).toBeUndefined();
  });

  it('should read a form, treat the earlier show as show-zero, and ignore differentRateGift', () => {
    expect(readGiftConnectionForm({ giftOnDocuments: { form: 'priced-in' } })).toBe('priced-in');
    expect(readGiftConnectionForm({ giftOnDocuments: { form: 'show' } })).toBe('show-zero');
    expect(
      readGiftConnectionForm({ giftOnDocuments: { form: 'omit', differentRateGift: 'priced-in' } }),
    ).toBe('omit');
  });

  it('should carry the global default beside it', () => {
    expect(readGiftDocumentSettings({}).giftGlobalForm).toBe('technical-cent');
    expect(readGiftDocumentSettings({ giftOnDocuments: { form: 'omit' } }, 'priced-in')).toEqual({
      giftConnectionForm: 'omit',
      giftGlobalForm: 'priced-in',
    });
  });

  it('should validate: form optional, legacy field accepted, unknown form refused', () => {
    expect(validateGiftOnDocumentsShape({})).toEqual([]);
    expect(validateGiftOnDocumentsShape({ form: 'show' })).toEqual([]);
    expect(validateGiftOnDocumentsShape({ form: 'omit', differentRateGift: 'x' })).toEqual([]);
    expect(validateGiftOnDocumentsShape({ form: 'hold' })).toHaveLength(1);
    expect(validateGiftOnDocumentsShape('omit')).toHaveLength(1);
  });

  it('should offer show-zero only where the provider declares it accepts zero', () => {
    expect(offeredGiftLineForms(true)).toEqual(GiftDocumentFormChoiceValues);
    expect(offeredGiftLineForms(false)).not.toContain('show-zero');
    expect(offeredGiftLineForms(undefined)).not.toContain('show-zero');
  });
});

describe('presentGiftLines', () => {
  const paidOnly = [line({ name: 'Set', unitPriceGross: 64.99 })];

  it('should leave lines untouched when no line is a gift', () => {
    const lines = [line({ unitPriceGross: 0 }), line({ unitPriceGross: 5 })];
    expect(presentGiftLines(lines, 'omit', true).lines).toEqual(lines);
  });

  it('should not treat a marked line the source priced above zero as a gift', () => {
    const result = presentGiftLines([...paidOnly, gift({ unitPriceGross: 3 })], 'omit', undefined);
    expect(total(result.lines)).toBe(6799);
  });

  it('should default to a technical cent taken from the most expensive paid line', () => {
    const result = presentGiftLines([...paidOnly, gift()], DEFAULT_GIFT_LINE_FORM, undefined);
    expect(result.lines.find((l) => l.name === 'Gift')?.unitPriceGross).toBeCloseTo(0.01);
    expect(result.lines.find((l) => l.name === 'Set')?.unitPriceGross).toBeCloseTo(64.98);
    expect(total(result.lines)).toBe(6499);
  });

  it('should take the cent from the most expensive line whatever its rate', () => {
    const lines = [
      line({ name: 'Small', unitPriceGross: 20, taxRate: '23' }),
      line({ name: 'Big', unitPriceGross: 80, taxRate: '5' }),
      gift({ taxRate: '23' }),
    ];
    const result = presentGiftLines(lines, 'technical-cent', false);
    expect(result.lines.find((l) => l.name === 'Big')?.unitPriceGross).toBeCloseTo(79.99);
    expect(result.lines.find((l) => l.name === 'Small')?.unitPriceGross).toBe(20);
    expect(total(result.lines)).toBe(10000);
  });

  it('should need no extra setting for a gift in a rate no paid line has', () => {
    const result = presentGiftLines(
      [line({ unitPriceGross: 50 }), gift({ taxRate: '8' })],
      'technical-cent',
      false,
    );
    expect(result.lines.find((l) => l.taxRate === '8')?.unitPriceGross).toBeCloseTo(0.01);
    expect(total(result.lines)).toBe(5000);
  });

  it('should split a multi-unit donor so the total still equals what was paid', () => {
    const result = presentGiftLines(
      [line({ quantity: 3, unitPriceGross: 10 }), gift({ quantity: 2 })],
      'technical-cent',
      false,
    );
    expect(total(result.lines)).toBe(3000);
  });

  it('should keep show-zero at 0,00 where the provider accepts zero', () => {
    const result = presentGiftLines([...paidOnly, gift()], 'show-zero', true);
    expect(result.lines[1].unitPriceGross).toBe(0);
    expect(total(result.lines)).toBe(6499);
  });

  it('should degrade show-zero to a technical cent where zero is not accepted', () => {
    for (const accepts of [false, undefined]) {
      const result = presentGiftLines([...paidOnly, gift()], 'show-zero', accepts);
      expect(result.notes).toContain('show-not-offered');
      expect(result.lines.find((l) => l.name === 'Gift')?.unitPriceGross).toBeCloseTo(0.01);
      expect(total(result.lines)).toBe(6499);
    }
  });

  it('should omit a gift and keep the paid total', () => {
    const result = presentGiftLines([...paidOnly, gift()], 'omit', true);
    expect(result.lines.map((l) => l.name)).toEqual(['Set']);
    expect(total(result.lines)).toBe(6499);
  });

  it('should keep an internal-record gift off the document and return it', () => {
    const result = presentGiftLines([...paidOnly, gift()], 'internal-record', true);
    expect(result.lines.map((l) => l.name)).toEqual(['Set']);
    expect(result.internalRecordLines.map((l) => l.name)).toEqual(['Gift']);
  });

  describe('priced-in', () => {
    it('should move part of the payment to the gift at its own rate', () => {
      const lines = [
        line({ name: 'A', unitPriceGross: 30 }),
        line({ name: 'B', unitPriceGross: 30, taxRate: '5' }),
        gift({ taxRate: '8', referenceUnitPriceGross: 10 }),
      ];
      const result = presentGiftLines(lines, 'priced-in', true);
      expect(total(result.lines)).toBe(6000);
      const giftLine = result.lines.find((l) => l.name === 'Gift');
      expect(giftLine?.unitPriceGross).toBeGreaterThan(0);
      expect(giftLine?.taxRate).toBe('8');
    });

    it('should allocate the rounding remainder once to the largest paid line', () => {
      const lines = [
        line({ name: 'Big', unitPriceGross: 33.33 }),
        line({ name: 'Small', unitPriceGross: 10.01 }),
        gift({ referenceUnitPriceGross: 7.77 }),
      ];
      expect(total(presentGiftLines(lines, 'priced-in', true).lines)).toBe(4334);
    });

    it('should drop a gift with no reference price, since there is nothing to price in', () => {
      const result = presentGiftLines([...paidOnly, gift()], 'priced-in', true);
      expect(result.notes).toContain('no-reference-price');
      expect(total(result.lines)).toBe(6499);
    });
  });

  it('should fall back to priced-in when no paid line can spare the cent', () => {
    const result = presentGiftLines(
      [line({ unitPriceGross: 0.01 }), gift({ referenceUnitPriceGross: 20 })],
      'technical-cent',
      false,
    );
    expect(result.notes).toContain('technical-cent-no-donor');
  });

  it('should never produce a 0.00 row when the donor would be left with less than a cent per unit', () => {
    // 3 units at 0.01: giving 1 cent would leave 0.02 over 3 units.
    const result = presentGiftLines(
      [line({ name: 'Cheap', quantity: 3, unitPriceGross: 0.01 }), gift()],
      'technical-cent',
      false,
    );
    expect(result.notes).toContain('technical-cent-no-donor');
    expect(result.lines.every((l) => Math.round(l.unitPriceGross * 100) >= 1)).toBe(true);
  });

  it('should try the next donor when the largest cannot spare the cent per unit', () => {
    const result = presentGiftLines(
      [
        line({ name: 'Big', quantity: 5, unitPriceGross: 0.01 }),
        line({ name: 'Small', quantity: 1, unitPriceGross: 0.1 }),
        gift(),
      ],
      'technical-cent',
      false,
    );
    expect(result.notes).not.toContain('technical-cent-no-donor');
    expect(result.lines.find((l) => l.name === 'Small')?.unitPriceGross).toBeCloseTo(0.09);
    expect(total(result.lines)).toBe(15);
  });

  it('should read an unrecognised per-gift form as the fallback form, not as priced-in', () => {
    const result = presentGiftLines(
      [...paidOnly, gift({ giftForm: 'bogus' as unknown as GiftLineForm })],
      'omit',
      undefined,
    );
    expect(result.appliedForm).toBe('omit');
    expect(result.lines.map((l) => l.name)).toEqual(['Set']);
    expect(total(result.lines)).toBe(6499);
  });

  it('should apply each gift its own form on one order', () => {
    const lines = [
      line({ name: 'Set', unitPriceGross: 100 }),
      gift({ name: 'G1', giftForm: 'omit' }),
      gift({ name: 'G2', giftForm: 'technical-cent' }),
      gift({ name: 'G3', giftForm: 'show-zero' }),
    ];
    const result = presentGiftLines(lines, 'priced-in', true);
    expect(result.lines.map((l) => l.name)).toEqual(['Set', 'G2', 'G3']);
    expect(result.lines.find((l) => l.name === 'G3')?.unitPriceGross).toBe(0);
    expect(total(result.lines)).toBe(10000);
  });

  it('should respect the currency minor unit', () => {
    const result = presentGiftLines([line({ unitPriceGross: 1000 }), gift()], 'technical-cent', false, {
      currency: 'JPY',
    });
    expect(result.lines[1].unitPriceGross).toBe(1);
    expect(result.lines[0].unitPriceGross + result.lines[1].unitPriceGross).toBe(1000);
  });

  it('should keep the document total equal to what was paid for every form', () => {
    const forms: GiftLineForm[] = ['technical-cent', 'custom-price', 'priced-in', 'show-zero', 'omit', 'internal-record'];
    for (const form of forms) {
      for (const accepts of [true, false, undefined]) {
        const result = presentGiftLines(
          [
            line({ unitPriceGross: 64.99 }),
            line({ unitPriceGross: 12.5, taxRate: '8', quantity: 3 }),
            gift({ taxRate: '5', referenceUnitPriceGross: 9.99, quantity: 2, giftUnitPriceGross: 4.5 }),
          ],
          form,
          accepts,
        );
        expect(total(result.lines)).toBe(10249);
      }
    }
  });

  describe('zero floor', () => {
    const paid = line({ name: 'Paid', unitPriceGross: 100 });

    it('should never leave a 0.00 line when the provider refuses zero', () => {
      const result = presentGiftLines([paid, line({ name: 'Free', unitPriceGross: 0 })], 'omit', false);
      expect(result.lines.every((l) => Math.round(l.unitPriceGross * 100) > 0)).toBe(true);
      expect(total(result.lines)).toBe(10000);
    });

    it('should name a zero line it cannot floor', () => {
      const result = presentGiftLines(
        [line({ name: 'Free', unitPriceGross: 0, taxRate: '8' }), paid],
        'omit',
        false,
      );
      expect(result.notes).toContain('zero-line-unfloorable');
    });
  });
});

describe('custom-price', () => {
  it('should accept only a positive amount with at most two decimals', () => {
    for (const ok of ['5', '5.0', '5.25', '0.01', '120.5']) expect(isGiftUnitPriceAmount(ok)).toBe(true);
    for (const bad of ['0', '0.00', '-1', '5.123', '', 'abc', 5, null, undefined]) {
      expect(isGiftUnitPriceAmount(bad)).toBe(false);
    }
  });

  it('should show the gift at the chosen price and take the same total from the largest paid line', () => {
    const result = presentGiftLines(
      [line({ name: 'Set', unitPriceGross: 64.99 }), gift({ giftUnitPriceGross: 5 })],
      'custom-price',
      false,
    );
    expect(result.lines.find((l) => l.name === 'Gift')?.unitPriceGross).toBe(5);
    expect(result.lines.find((l) => l.name === 'Set')?.unitPriceGross).toBeCloseTo(59.99);
    expect(total(result.lines)).toBe(6499);
    expect(result.appliedForm).toBe('custom-price');
    expect(result.notes).toEqual([]);
  });

  it('should multiply the amount by the gift quantity and split the donor line', () => {
    const result = presentGiftLines(
      [line({ name: 'Set', quantity: 3, unitPriceGross: 10 }), gift({ quantity: 2, giftUnitPriceGross: 2.5 })],
      'custom-price',
      false,
    );
    const gifts = result.lines.filter((l) => l.name === 'Gift');
    expect(gifts).toHaveLength(1);
    expect(gifts[0].quantity).toBe(2);
    expect(gifts[0].unitPriceGross).toBe(2.5);
    // 5.00 taken from 30.00: 25.00 over 3 units does not divide, so it splits.
    expect(result.lines.filter((l) => l.name === 'Set')).toHaveLength(2);
    expect(total(result.lines)).toBe(3000);
  });

  it('should take it from the most expensive line whatever its rate, and behave as technical-cent at 0.01', () => {
    const lines = [
      line({ name: 'Small', unitPriceGross: 20, taxRate: '23' }),
      line({ name: 'Big', unitPriceGross: 80, taxRate: '5' }),
      gift({ taxRate: '8' }),
    ];
    const custom = presentGiftLines(
      lines.map((l) => (l.name === 'Gift' ? { ...l, giftUnitPriceGross: 0.01 } : l)),
      'custom-price',
      false,
    );
    const cent = presentGiftLines(lines, 'technical-cent', false);
    const prices = (r: typeof cent) => r.lines.map((l) => [l.name, l.quantity, l.unitPriceGross]);
    expect(prices(custom)).toEqual(prices(cent));
  });

  it('should name why and fall back when no paid line can absorb it', () => {
    const result = presentGiftLines(
      [line({ unitPriceGross: 10 }), gift({ giftUnitPriceGross: 10, referenceUnitPriceGross: 10 })],
      'custom-price',
      false,
    );
    expect(result.notes).toContain('custom-price-no-donor');
    expect(total(result.lines)).toBe(1000);
  });

  it('should not let the donor drop below a minor unit per unit', () => {
    const result = presentGiftLines(
      [line({ unitPriceGross: 10 }), gift({ giftUnitPriceGross: 9.99 })],
      'custom-price',
      false,
    );
    expect(result.notes).not.toContain('custom-price-no-donor');
    expect(result.lines.find((l) => l.name === 'Item')?.unitPriceGross).toBeCloseTo(0.01);
    expect(total(result.lines)).toBe(1000);
  });

  it('should note an unusable amount and apply technical-cent instead', () => {
    const result = presentGiftLines(
      [line({ unitPriceGross: 10 }), gift()],
      'custom-price',
      false,
    );
    expect(result.notes).toContain('custom-price-invalid');
    expect(result.lines.find((l) => l.name === 'Gift')?.unitPriceGross).toBeCloseTo(0.01);
  });

  describe('precedence', () => {
    it('should carry the amount of the level that wins', () => {
      expect(
        resolveGiftDocumentForm('custom-price', 'custom-price', 'omit', { line: '3', connection: '4' }),
      ).toEqual({ form: 'custom-price', source: 'rule', unitPrice: '3' });
      expect(
        resolveGiftDocumentForm(undefined, 'custom-price', 'custom-price', { connection: '4', global: '5' }),
      ).toEqual({ form: 'custom-price', source: 'connection', unitPrice: '4' });
      expect(
        resolveGiftDocumentForm(undefined, undefined, 'custom-price', { global: '5.5' }),
      ).toEqual({ form: 'custom-price', source: 'default', unitPrice: '5.5' });
    });

    it('should read a level naming custom-price without a usable amount as absent, never borrowing a less specific amount', () => {
      expect(
        resolveGiftDocumentForm('custom-price', 'priced-in', undefined, { line: '0', connection: '9' }),
      ).toEqual({ form: 'priced-in', source: 'connection' });
      expect(
        resolveGiftDocumentForm(undefined, 'custom-price', 'custom-price', { global: '5' }),
      ).toEqual({ form: 'custom-price', source: 'default', unitPrice: '5' });
      expect(resolveGiftDocumentForm('custom-price', undefined, undefined)).toEqual({
        form: 'technical-cent',
        source: 'default',
      });
    });

    it('should hand a mapper the form and the amount as a number', () => {
      expect(
        resolveGiftPresentationFields(undefined, undefined, {
          giftConnectionForm: 'custom-price',
          giftConnectionUnitPrice: '4.20',
        }),
      ).toEqual({ giftForm: 'custom-price', giftUnitPriceGross: 4.2 });
      expect(resolveGiftPresentationFields('omit', undefined, {})).toEqual({ giftForm: 'omit' });
    });
  });

  describe('connection config', () => {
    it('should read and validate the amount', () => {
      const config = { giftOnDocuments: { form: 'custom-price', unitPrice: '4.5' } };
      expect(readGiftConnectionUnitPrice(config)).toBe('4.5');
      expect(readGiftConnectionUnitPrice({ giftOnDocuments: { unitPrice: '0' } })).toBeUndefined();
      expect(readGiftDocumentSettings(config, 'omit', '7')).toEqual({
        giftConnectionForm: 'custom-price',
        giftConnectionUnitPrice: '4.5',
        giftGlobalForm: 'omit',
        giftGlobalUnitPrice: '7',
      });
      expect(validateGiftOnDocumentsShape(config)).toEqual([]);
      expect(validateGiftOnDocumentsShape({ form: 'custom-price' })).toHaveLength(1);
      expect(validateGiftOnDocumentsShape({ form: 'custom-price', unitPrice: '1.234' })).toHaveLength(2);
      expect(validateGiftOnDocumentsShape({ form: 'omit', unitPrice: 'x' })).toHaveLength(1);
    });
  });
});
