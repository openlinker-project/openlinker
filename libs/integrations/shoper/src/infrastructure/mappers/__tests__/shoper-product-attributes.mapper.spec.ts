import type { OfferParameter } from '@openlinker/core/listings';

import type { ShoperAttribute } from '../../../domain/types/shoper-api.types';
import {
  findShoperAttributeGroup,
  findShoperAttributesByName,
  isShoperAttributeGroupBound,
  resolveShoperAttributeValue,
} from '../shoper-product-attributes.mapper';

// Shapes as the live shop answers them (2026-10-23): ids and the type are strings.
const COLOUR: ShoperAttribute = {
  attribute_id: '28',
  attribute_group_id: '8',
  name: 'Kolor',
  type: '2',
  options: [
    { option_id: '112', value: 'Czerwony', order: '1' },
    { option_id: '113', value: 'Serenity', order: '2' },
  ],
};

function param(overrides: Partial<OfferParameter>): OfferParameter {
  return { id: '28', section: 'product', ...overrides };
}

describe('resolveShoperAttributeValue', () => {
  describe('select attribute', () => {
    it('should translate the picked option id into the option text Shoper requires', () => {
      const result = resolveShoperAttributeValue(param({ valuesIds: ['113'] }), COLOUR, '28', true);

      expect(result).toEqual({ ok: true, value: 'Serenity' });
    });

    it("should send the shop's own spelling when the text matches an option ignoring case", () => {
      const result = resolveShoperAttributeValue(param({ values: [' serenity '] }), COLOUR, '28', true);

      expect(result).toEqual({ ok: true, value: 'Serenity' });
    });

    it('should not send a text that is not one of the options, because Shoper refuses the whole product', () => {
      const result = resolveShoperAttributeValue(param({ values: ['Fioletowy'] }), COLOUR, '28', true);

      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.warning).toMatch(/"Kolor" \(attribute 28\).*"Fioletowy" is not one of its options/);
    });

    it('should not send an option id the attribute does not have', () => {
      const result = resolveShoperAttributeValue(param({ valuesIds: ['999'] }), COLOUR, '28', true);

      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.warning).toContain('option 999');
    });

    it('should fall back to the text when the option id is unknown but the text matches', () => {
      const result = resolveShoperAttributeValue(
        param({ valuesIds: ['999'], values: ['Czerwony'] }),
        COLOUR,
        '28',
        true,
      );

      expect(result).toEqual({ ok: true, value: 'Czerwony' });
    });

    it('should ignore value ids it was told not to trust, since they may be another platform dictionary ids', () => {
      // 113 is a Shoper option id, but here it came from a projection matched by name.
      const result = resolveShoperAttributeValue(
        param({ id: 'Kolor', valuesIds: ['113'], values: ['Czerwony'] }),
        COLOUR,
        '28',
        false,
      );

      expect(result).toEqual({ ok: true, value: 'Czerwony' });
    });

    it('should send only the first of several values, and say so', () => {
      const result = resolveShoperAttributeValue(
        param({ valuesIds: ['112', '113'], values: ['Czerwony', 'Serenity'] }),
        COLOUR,
        '28',
        true,
      );

      expect(result).toMatchObject({ ok: true, value: 'Czerwony' });
      expect(result.ok && result.warning).toContain('Only the first value');
    });

    it('should report a parameter with no value at all', () => {
      const result = resolveShoperAttributeValue(param({}), COLOUR, '28', true);

      expect(result).toEqual({ ok: false, warning: expect.stringContaining('carries no value') });
    });
  });

  it('should send a text attribute value as given', () => {
    const text: ShoperAttribute = { attribute_id: '30', name: 'Wymiary', type: '0' };

    const result = resolveShoperAttributeValue(param({ id: '30', values: ['  20 x 30 cm '] }), text, '30', true);

    expect(result).toEqual({ ok: true, value: '20 x 30 cm' });
  });

  it('should not send a checkbox attribute, whose write format is not verified', () => {
    const checkbox: ShoperAttribute = { attribute_id: '31', name: 'Eko', type: '1' };

    const result = resolveShoperAttributeValue(param({ id: '31', values: ['1'] }), checkbox, '31', true);

    expect(result).toEqual({ ok: false, warning: expect.stringContaining('checkbox') });
  });
});

describe('findShoperAttributesByName', () => {
  it('should match ignoring case and surrounding whitespace, and keep every match', () => {
    const rows: ShoperAttribute[] = [
      COLOUR,
      { attribute_id: '40', name: 'kolor ' },
      { attribute_id: '41', name: 'Rozmiar' },
    ];

    expect(findShoperAttributesByName(rows, ' KOLOR').map((r) => r.attribute_id)).toEqual(['28', '40']);
  });
});

describe('attribute group binding', () => {
  const groups = [
    { attribute_group_id: '8', name: 'Wygląd', categories: [45, 38] },
    { attribute_group_id: '9', name: 'Inne', categories: [] },
  ];

  it('should count an attribute as kept when its group lists the category', () => {
    expect(isShoperAttributeGroupBound(findShoperAttributeGroup(groups, COLOUR), 38)).toBe(true);
  });

  it('should count an attribute as dropped when its group does not list the category', () => {
    expect(isShoperAttributeGroupBound(findShoperAttributeGroup(groups, COLOUR), 12)).toBe(false);
  });

  it('should treat a group it cannot find as unbound', () => {
    const orphan: ShoperAttribute = { ...COLOUR, attribute_group_id: '77' };

    expect(isShoperAttributeGroupBound(findShoperAttributeGroup(groups, orphan), 38)).toBe(false);
  });

  it('should compare category ids sent as strings', () => {
    expect(isShoperAttributeGroupBound({ attribute_group_id: '8', categories: ['38'] }, 38)).toBe(true);
  });
});
