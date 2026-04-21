import { describe, expect, it } from 'vitest';
import { editConnectionSchema, mergeStructuredIntoConfig } from './edit-connection.schema';

describe('mergeStructuredIntoConfig', () => {
  it('writes a new baseUrl into an empty config', () => {
    const result = mergeStructuredIntoConfig({}, { baseUrl: 'https://shop.example.com' });
    expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
  });

  it('overwrites an existing baseUrl without losing unknown keys', () => {
    const base = {
      baseUrl: 'https://old.example.com',
      customField: 'preserve-me',
      nested: { deep: true },
    };
    const result = mergeStructuredIntoConfig(base, { baseUrl: 'https://new.example.com' });
    expect(result).toEqual({
      baseUrl: 'https://new.example.com',
      customField: 'preserve-me',
      nested: { deep: true },
    });
  });

  it('deletes baseUrl when the structured input is cleared to an empty string', () => {
    const base = { baseUrl: 'https://shop.example.com', shopId: '1' };
    const result = mergeStructuredIntoConfig(base, { baseUrl: '' });
    expect(result).toEqual({ shopId: '1' });
    expect('baseUrl' in result).toBe(false);
  });

  it('leaves keys untouched when the structured patch omits them', () => {
    const base = { baseUrl: 'https://shop.example.com', shopId: '1' };
    const result = mergeStructuredIntoConfig(base, {});
    expect(result).toEqual(base);
  });

  it('deletes shopId when cleared but keeps baseUrl', () => {
    const base = { baseUrl: 'https://shop.example.com', shopId: '2' };
    const result = mergeStructuredIntoConfig(base, { shopId: '' });
    expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
  });

  it('does not mutate the base object', () => {
    const base = { baseUrl: 'https://shop.example.com', customField: 'x' };
    const snapshot = { ...base };
    mergeStructuredIntoConfig(base, { baseUrl: 'https://new.example.com' });
    expect(base).toEqual(snapshot);
  });

  it('writes storefrontBaseUrl into an empty config', () => {
    const result = mergeStructuredIntoConfig(
      {},
      { storefrontBaseUrl: 'https://shop.example.com' },
    );
    expect(result).toEqual({ storefrontBaseUrl: 'https://shop.example.com' });
  });

  it('deletes storefrontBaseUrl when cleared to empty string', () => {
    const base = {
      baseUrl: 'https://api.shop.example.com',
      storefrontBaseUrl: 'https://shop.example.com',
    };
    const result = mergeStructuredIntoConfig(base, { storefrontBaseUrl: '' });
    expect(result).toEqual({ baseUrl: 'https://api.shop.example.com' });
    expect('storefrontBaseUrl' in result).toBe(false);
  });
});

// Direct-schema tests live here alongside the helper tests for symmetry with
// the existing file. Only the fields changed by #283 are covered today —
// extend as additional fields gain validation rules.
describe('editConnectionSchema — storefrontBaseUrl', () => {
  const validRest = {
    name: 'Shop',
    configText: '{}',
  };

  it('accepts an absent storefrontBaseUrl', () => {
    const result = editConnectionSchema.safeParse(validRest);
    expect(result.success).toBe(true);
  });

  it('accepts an empty string (unset signal)', () => {
    const result = editConnectionSchema.safeParse({ ...validRest, storefrontBaseUrl: '' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid https URL', () => {
    const result = editConnectionSchema.safeParse({
      ...validRest,
      storefrontBaseUrl: 'https://shop.example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a garbage value with the expected message', () => {
    const result = editConnectionSchema.safeParse({
      ...validRest,
      storefrontBaseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('storefrontBaseUrl'));
      expect(issue?.message).toBe('Storefront URL must be a valid URL');
    }
  });
});
