import type { OfferParameter } from '@openlinker/core/listings';

import {
  definitionChoices,
  planMetafields,
  toMetafieldKey,
  type ShopifyMetafieldDefinitionNode,
} from '../shopify-product-metafields.mapper';

function definition(
  namespace: string,
  key: string,
  type: string,
  choices?: string[],
): ShopifyMetafieldDefinitionNode {
  return {
    id: `gid://shopify/MetafieldDefinition/${key}`,
    name: key,
    namespace,
    key,
    type: { name: type },
    validations: choices === undefined ? [] : [{ name: 'choices', value: JSON.stringify(choices) }],
  };
}

const param = (id: string, values: string[]): OfferParameter => ({ id, values }) as OfferParameter;

describe('planMetafields', () => {
  it('should write a linked parameter into its definition with the definition type', () => {
    const defs = new Map([['custom.material', definition('custom', 'material', 'list.single_line_text_field')]]);

    expect(planMetafields([param('custom.material', ['Bawełna', 'Len'])], defs).writes).toEqual([
      { namespace: 'custom', key: 'material', type: 'list.single_line_text_field', value: '["Bawełna","Len"]' },
    ]);
  });

  it('should write any other parameter as OpenLinker text', () => {
    expect(planMetafields([param('Kolor ramy', ['Czarny'])], null).writes).toEqual([
      { namespace: 'openlinker', key: 'kolor_ramy', type: 'single_line_text_field', value: 'Czarny' },
    ]);
  });

  it('should refuse a reference-typed definition with a warning', () => {
    const defs = new Map([['shopify.color', definition('shopify', 'color', 'list.metaobject_reference')]]);

    const plan = planMetafields([param('shopify.color', ['red'])], defs);

    expect(plan.writes).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
  });

  it('should skip a parameter without text and a second one writing the same key', () => {
    const plan = planMetafields([param('A b', []), param('Waga', ['1']), param('waga', ['2'])], null);

    expect(plan.writes).toHaveLength(1);
    expect(plan.warnings).toHaveLength(2);
  });
});

describe('definitionChoices / toMetafieldKey', () => {
  it('should read the choices validation and tolerate a broken one', () => {
    expect(definitionChoices(definition('c', 'k', 'single_line_text_field', ['S', 'M']))).toEqual(['S', 'M']);
    expect(
      definitionChoices({ ...definition('c', 'k', 'single_line_text_field'), validations: [{ name: 'choices', value: '{' }] }),
    ).toEqual([]);
  });

  it('should make a key of at least two characters', () => {
    expect(toMetafieldKey('X')).toBe('p_x');
  });
});
