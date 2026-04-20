import { describe, expect, it } from 'vitest';
import { mergeStructuredIntoConfig } from './edit-connection.schema';

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
});
