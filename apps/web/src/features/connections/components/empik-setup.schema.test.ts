/**
 * Empik setup schema tests
 */
import { describe, expect, it } from 'vitest';
import { empikSetupSchema, toCreateConnectionInput } from './empik-setup.schema';

const base = { name: 'Empik', apiKey: 'key', environment: 'staging' as const, shopId: '' };

describe('empikSetupSchema', () => {
  it('should accept an empty shop id', () => {
    expect(empikSetupSchema.safeParse(base).success).toBe(true);
  });

  it.each(['0', '-1', '12a', '1.5'])('should refuse the shop id %s', (shopId) => {
    expect(empikSetupSchema.safeParse({ ...base, shopId }).success).toBe(false);
  });

  it('should refuse an environment Empik does not have', () => {
    expect(empikSetupSchema.safeParse({ ...base, environment: 'sandbox' }).success).toBe(false);
  });
});

describe('toCreateConnectionInput', () => {
  it('should send the environment and omit an empty shop id', () => {
    expect(toCreateConnectionInput(base)).toEqual({
      name: 'Empik',
      platformType: 'empik',
      adapterKey: 'empik.mirakl.v1',
      credentials: { apiKey: 'key' },
      config: { environment: 'staging' },
    });
  });

  it('should send the shop id when one is given', () => {
    expect(toCreateConnectionInput({ ...base, shopId: '6881' }).config).toEqual({
      environment: 'staging',
      shopId: '6881',
    });
  });
});
