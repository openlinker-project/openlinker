/**
 * attribute-projection-summary - unit tests (#3995)
 */
import { describe, expect, it } from 'vitest';
import type { AttributeProjectionPreviewEntry, ProjectedParameterOrigin } from '../api/listings.types';
import { formatPlural, messagesIn, type InterpolationParams, type PluralForms } from '../../../shared/i18n';
import { describeOrigin, listParameterNames, summarizeProjection } from './attribute-projection-summary';

const copy = messagesIn('listings', 'en').attributeRules;
const plural = (n: number, forms: PluralForms, params?: InterpolationParams): string =>
  formatPlural(n, forms, 'en', params);

const origin = (over: Partial<ProjectedParameterOrigin>): ProjectedParameterOrigin => ({
  parameterId: 'p1',
  parameterName: 'Kolor',
  section: 'product',
  source: 'rule',
  rawValue: 'czarny',
  outcome: 'accepted',
  rule: { id: 'r1', kind: 'fixed' },
  ...over,
});

const okEntry = (origins: ProjectedParameterOrigin[]): AttributeProjectionPreviewEntry => ({
  variantId: 'v1',
  categoryId: 'cat-1',
  status: 'ok',
  parameters: [],
  unresolvedRequired: [],
  restrictionIssues: [],
  origins,
});

describe('summarizeProjection', () => {
  it('should split rule-filled values from rejected ones and leave mapping values out of the rule count', () => {
    const summary = summarizeProjection(
      okEntry([
        origin({ parameterId: 'size', parameterName: 'Rozmiar' }),
        origin({ parameterId: 'color', outcome: 'rejected', rawValue: 'Navy' }),
        origin({ parameterId: 'mat', source: 'mapping', rule: undefined }),
      ]),
      'cat-1',
    );
    expect(summary?.ruleFilled.map((o) => o.parameterId)).toEqual(['size']);
    expect(summary?.rejected.map((o) => o.parameterId)).toEqual(['color']);
    expect(summary?.byParameterId.get('mat')?.source).toBe('mapping');
  });

  it('should say nothing for a failed entry, a missing entry, or another category', () => {
    expect(summarizeProjection(undefined, 'cat-1')).toBeNull();
    expect(
      summarizeProjection(
        { variantId: 'v1', categoryId: 'cat-1', status: 'failed', reason: 'projection-failed' },
        'cat-1',
      ),
    ).toBeNull();
    expect(summarizeProjection(okEntry([origin({})]), 'cat-2')).toBeNull();
  });
});

describe('describeOrigin', () => {
  it('should name the source attribute of a copied value and say when it was translated', () => {
    expect(
      describeOrigin(
        origin({ rule: { id: 'r', kind: 'copy-remap', sourceAttributeKey: 'Color', remapped: true } }),
        copy.origin,
      ),
    ).toBe('Copied from "Color" and translated by your attribute rules');
    expect(
      describeOrigin(
        origin({ rule: { id: 'r', kind: 'copy-remap', sourceAttributeKey: 'Size', remapped: false } }),
        copy.origin,
      ),
    ).toBe('Copied from "Size" by your attribute rules');
  });

  it('should name the product field of a placed value', () => {
    expect(describeOrigin(origin({ rule: { id: 'r', kind: 'place-value', placeSource: 'ean' } }), copy.origin)).toBe(
      'Product EAN, placed by your attribute rules',
    );
  });

  it('should tell a fixed rule and a mapping apart', () => {
    expect(describeOrigin(origin({}), copy.origin)).toBe('Fixed value from your attribute rules');
    expect(describeOrigin(origin({ source: 'mapping', rule: undefined }), copy.origin)).toBe(
      'From your attribute mapping',
    );
  });
});

describe('listParameterNames', () => {
  it('should cap a long list', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => origin({ parameterName: n }));
    expect(listParameterNames(names, copy.parameterList, plural)).toBe('A, B, C, D and 2 more');
    expect(listParameterNames(names.slice(0, 2), copy.parameterList, plural)).toBe('A, B');
  });
});
