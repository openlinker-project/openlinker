/**
 * flattenValidationErrors — unit tests
 *
 * Pins the `{ path, message }[]` wire format preserved from the pre-#587
 * `apps/api/.../util/flatten-validation-errors.ts`. Tests against the
 * structural `ValidationErrorLike` interface — no class-validator import.
 *
 * @module libs/core/src/integrations/application/util
 */
import {
  flattenValidationErrors,
  type ValidationErrorLike,
} from './flatten-validation-errors';

describe('flattenValidationErrors', () => {
  it('returns an empty list for no errors', () => {
    expect(flattenValidationErrors([])).toEqual([]);
  });

  it('flattens a single field with one constraint', () => {
    const errors: ValidationErrorLike[] = [
      { property: 'baseUrl', constraints: { isUrl: 'baseUrl must be a URL' } },
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      { path: 'baseUrl', message: 'baseUrl must be a URL' },
    ]);
  });

  it('emits one entry per constraint for a multi-constraint field', () => {
    const errors: ValidationErrorLike[] = [
      {
        property: 'apiKey',
        constraints: {
          isString: 'apiKey must be a string',
          isNotEmpty: 'apiKey must not be empty',
        },
      },
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      { path: 'apiKey', message: 'apiKey must be a string' },
      { path: 'apiKey', message: 'apiKey must not be empty' },
    ]);
  });

  it('recurses into children, joining property names with "."', () => {
    const errors: ValidationErrorLike[] = [
      {
        property: 'sellerDefaults',
        children: [
          {
            property: 'location',
            children: [
              {
                property: 'postcode',
                constraints: { matches: 'postcode must match ^\\d{2}-\\d{3}$' },
              },
            ],
          },
        ],
      },
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      {
        path: 'sellerDefaults.location.postcode',
        message: 'postcode must match ^\\d{2}-\\d{3}$',
      },
    ]);
  });

  it('emits both parent and child errors when both have constraints', () => {
    const errors: ValidationErrorLike[] = [
      {
        property: 'config',
        constraints: { isObject: 'config must be an object' },
        children: [
          { property: 'apiKey', constraints: { isString: 'apiKey must be a string' } },
        ],
      },
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      { path: 'config', message: 'config must be an object' },
      { path: 'config.apiKey', message: 'apiKey must be a string' },
    ]);
  });
});
