/**
 * Build Parameters Zod Schema — unit tests
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import type { CategoryParameter } from '../api/listings.types';
import { buildParametersZodSchema } from './build-parameters-zod-schema';

function param(overrides: Partial<CategoryParameter>): CategoryParameter {
  return {
    id: 'x',
    name: 'X',
    type: 'string',
    required: false,
    restrictions: {},
    ...overrides,
  };
}

describe('buildParametersZodSchema', () => {
  it('flags missing required string', () => {
    const schema = buildParametersZodSchema([param({ id: 'p1', name: 'P1', required: true })]);
    const result = schema.safeParse({ p1: '' });
    expect(result.success).toBe(false);
  });

  it('passes when required field has a value', () => {
    const schema = buildParametersZodSchema([param({ id: 'p1', name: 'P1', required: true })]);
    const result = schema.safeParse({ p1: 'something' });
    expect(result.success).toBe(true);
  });

  it('skips required-check for hidden (dependsOn-unsatisfied) fields', () => {
    const schema = buildParametersZodSchema([
      param({ id: 'parent', type: 'dictionary' }),
      param({
        id: 'child',
        type: 'dictionary',
        required: true,
        dependsOn: { parameterId: 'parent', valueIds: ['p_yes'] },
        dictionary: [{ id: 'c_a', value: 'A' }],
      }),
    ]);
    // parent unset → child hidden → child.required NOT enforced
    const result = schema.safeParse({ parent: undefined, child: undefined });
    expect(result.success).toBe(true);
  });

  it('rejects integer that is not a whole number', () => {
    const schema = buildParametersZodSchema([
      param({ id: 'p1', type: 'integer' }),
    ]);
    expect(schema.safeParse({ p1: '1.5' }).success).toBe(false);
    expect(schema.safeParse({ p1: '1' }).success).toBe(true);
  });

  it('rejects float that is not numeric', () => {
    const schema = buildParametersZodSchema([
      param({ id: 'p1', type: 'float' }),
    ]);
    expect(schema.safeParse({ p1: 'abc' }).success).toBe(false);
    expect(schema.safeParse({ p1: '3.14' }).success).toBe(true);
  });

  it('rejects ranges with from > to', () => {
    const schema = buildParametersZodSchema([
      param({ id: 'p1', type: 'integer', restrictions: { range: true } }),
    ]);
    expect(schema.safeParse({ p1: { from: '10', to: '5' } }).success).toBe(false);
    expect(schema.safeParse({ p1: { from: '5', to: '10' } }).success).toBe(true);
  });

  it('rejects strings outside length bounds', () => {
    const schema = buildParametersZodSchema([
      param({
        id: 'p1',
        type: 'string',
        restrictions: { minLength: 8, maxLength: 14 },
      }),
    ]);
    expect(schema.safeParse({ p1: 'short' }).success).toBe(false);
    expect(schema.safeParse({ p1: '12345678' }).success).toBe(true);
    expect(schema.safeParse({ p1: '123456789012345' }).success).toBe(false);
  });

  it('rejects dictionary selection that is not in the parent-narrowed entry set', () => {
    const schema = buildParametersZodSchema([
      param({ id: 'parent', type: 'dictionary' }),
      param({
        id: 'child',
        type: 'dictionary',
        dependsOn: { parameterId: 'parent', valueIds: ['p_a'] },
        dictionary: [
          { id: 'c_only_under_a', value: 'A-only', dependsOnValueIds: ['p_a'] },
          { id: 'c_only_under_b', value: 'B-only', dependsOnValueIds: ['p_b'] },
        ],
      }),
    ]);
    // parent = p_a → c_only_under_a allowed, c_only_under_b is not
    const ok = schema.safeParse({ parent: 'p_a', child: 'c_only_under_a' });
    expect(ok.success).toBe(true);
    const bad = schema.safeParse({ parent: 'p_a', child: 'c_only_under_b' });
    expect(bad.success).toBe(false);
  });
});
