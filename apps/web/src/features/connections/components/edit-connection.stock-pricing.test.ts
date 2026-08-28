/**
 * Stock policy + pricing rule schema and merge tests (#2610)
 *
 * The two boundaries that matter: a margin of 100% or more must be refused
 * client-side (the server silently degrades it to the catalogue price), and an
 * explicit `0` must stay an explicit `0` rather than collapsing into unset.
 *
 * @module features/connections/components
 */
import { describe, expect, it } from 'vitest';
import { editConnectionSchema, mergeStructuredIntoConfig } from './edit-connection.schema';

function parse(values: Record<string, unknown>): ReturnType<typeof editConnectionSchema.safeParse> {
  return editConnectionSchema.safeParse({ name: 'Shop', configText: '{}', ...values });
}

function messages(result: ReturnType<typeof editConnectionSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('pricing rule validation', () => {
  it('accepts a markup', () => {
    expect(parse({ pricingRule: { type: 'markup', percent: '25' } }).success).toBe(true);
  });

  it('accepts a margin below 100', () => {
    expect(parse({ pricingRule: { type: 'margin', percent: '99.99' } }).success).toBe(true);
  });

  it('refuses a margin of exactly 100', () => {
    const result = parse({ pricingRule: { type: 'margin', percent: '100' } });
    expect(result.success).toBe(false);
    expect(messages(result).join(' ')).toContain('below 100%');
  });

  it('refuses a margin above 100', () => {
    expect(parse({ pricingRule: { type: 'margin', percent: '120' } }).success).toBe(false);
  });

  it('allows a markup of 100 or more — only a margin has the upper bound', () => {
    expect(parse({ pricingRule: { type: 'markup', percent: '150' } }).success).toBe(true);
  });

  it('requires a percentage for a markup', () => {
    const result = parse({ pricingRule: { type: 'markup', percent: '' } });
    expect(result.success).toBe(false);
    expect(messages(result).join(' ')).toContain('Enter a percentage');
  });

  it('does not require a percentage for a passthrough rule', () => {
    expect(parse({ pricingRule: { type: 'passthrough', percent: '' } }).success).toBe(true);
  });

  it('refuses a negative percentage', () => {
    expect(parse({ pricingRule: { type: 'markup', percent: '-5' } }).success).toBe(false);
  });
});

describe('stock policy validation', () => {
  it('accepts an explicit 0', () => {
    expect(parse({ stockPolicy: { safetyBuffer: '0', zeroThreshold: '0' } }).success).toBe(true);
  });

  it('accepts an empty knob (unset)', () => {
    expect(parse({ stockPolicy: { safetyBuffer: '', zeroThreshold: '' } }).success).toBe(true);
  });

  it('refuses a negative buffer', () => {
    expect(parse({ stockPolicy: { safetyBuffer: '-1' } }).success).toBe(false);
  });

  it('refuses a fractional buffer', () => {
    expect(parse({ stockPolicy: { safetyBuffer: '1.5' } }).success).toBe(false);
  });
});

describe('mergeStructuredIntoConfig — stock policy (#2610)', () => {
  it('writes both knobs as numbers', () => {
    const result = mergeStructuredIntoConfig(
      {},
      { stockPolicy: { safetyBuffer: '3', zeroThreshold: '5' } },
    );
    expect(result).toEqual({ stockSafetyBuffer: 3, stockZeroThreshold: 5 });
  });

  it('persists an explicit 0 as 0, never as null', () => {
    const result = mergeStructuredIntoConfig(
      {},
      { stockPolicy: { safetyBuffer: '0', zeroThreshold: '' } },
    );
    expect(result.stockSafetyBuffer).toBe(0);
    expect(result.stockZeroThreshold).toBeNull();
  });

  it('writes an explicit null for a cleared knob rather than deleting the key', () => {
    const result = mergeStructuredIntoConfig(
      { stockSafetyBuffer: 4 },
      { stockPolicy: { safetyBuffer: '', zeroThreshold: '' } },
    );
    expect('stockSafetyBuffer' in result).toBe(true);
    expect(result.stockSafetyBuffer).toBeNull();
  });

  it('leaves both keys untouched when no stock policy is supplied', () => {
    const result = mergeStructuredIntoConfig({ stockSafetyBuffer: 4 }, { baseUrl: 'https://x.dev' });
    expect(result.stockSafetyBuffer).toBe(4);
  });
});

describe('mergeStructuredIntoConfig — pricing rule (#2610)', () => {
  it('writes the whole rule object', () => {
    const result = mergeStructuredIntoConfig(
      {},
      { pricingRule: { type: 'markup', percent: '25', rounding: 'endingIn99' } },
    );
    expect(result.pricingRule).toEqual({ type: 'markup', percent: 25, rounding: 'endingIn99' });
  });

  it('omits the percentage for a passthrough rule', () => {
    const result = mergeStructuredIntoConfig(
      {},
      { pricingRule: { type: 'passthrough', percent: '25', rounding: 'none' } },
    );
    expect(result.pricingRule).toEqual({ type: 'passthrough', rounding: 'none' });
  });

  it('writes an explicit null when the type is cleared', () => {
    const result = mergeStructuredIntoConfig(
      { pricingRule: { type: 'markup', percent: 25 } },
      { pricingRule: { type: '', percent: '', rounding: '' } },
    );
    expect(result.pricingRule).toBeNull();
  });
});
