import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildEditConnectionSchema,
  editConnectionSchema,
  mergeStructuredIntoConfig,
  type EditConnectionStructuredPatch,
} from './edit-connection.schema';
import type { ConnectionConfigContribution } from '../../../shared/plugins';

describe('mergeStructuredIntoConfig', () => {
  it('writes a new baseUrl into an empty config', () => {
    const result = mergeStructuredIntoConfig({}, { baseUrl: 'https://shop.example.com' });
    expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
  });

  it('writes a new siteUrl into an empty config (WooCommerce, #975)', () => {
    const result = mergeStructuredIntoConfig({}, { siteUrl: 'https://wc.example.com' });
    expect(result).toEqual({ siteUrl: 'https://wc.example.com' });
  });

  it('deletes siteUrl when the structured input is cleared to an empty string', () => {
    const base = { siteUrl: 'https://wc.example.com', customField: 'preserve-me' };
    const result = mergeStructuredIntoConfig(base, { siteUrl: '' });
    expect(result).toEqual({ customField: 'preserve-me' });
    expect('siteUrl' in result).toBe(false);
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

  describe('defaultCarrierId (#517)', () => {
    it('coerces a positive integer string into a number on write', () => {
      const result = mergeStructuredIntoConfig({}, { defaultCarrierId: '7' });
      expect(result).toEqual({ defaultCarrierId: 7 });
    });

    it('deletes the key when cleared to an empty string', () => {
      const base = { defaultCarrierId: 7, baseUrl: 'https://shop.example.com' };
      const result = mergeStructuredIntoConfig(base, { defaultCarrierId: '' });
      expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
      expect('defaultCarrierId' in result).toBe(false);
    });

    it('leaves the key untouched when the patch omits it', () => {
      const base = { defaultCarrierId: 7 };
      const result = mergeStructuredIntoConfig(base, { baseUrl: 'https://shop.example.com' });
      expect(result).toEqual({ defaultCarrierId: 7, baseUrl: 'https://shop.example.com' });
    });
  });

  describe('unmanagedStockQuantity (WooCommerce, #969 §7.3)', () => {
    it('writes a coerced number nested under inventory into an empty config', () => {
      const result = mergeStructuredIntoConfig({}, { unmanagedStockQuantity: '500' });
      expect(result).toEqual({ inventory: { unmanagedStockQuantity: 500 } });
    });

    it('preserves sibling inventory keys when overwriting', () => {
      const base = {
        siteUrl: 'https://wc.example.com',
        inventory: { unmanagedStockQuantity: 1000, futureKey: 'preserve-me' },
      };
      const result = mergeStructuredIntoConfig(base, { unmanagedStockQuantity: '250' });
      expect(result).toEqual({
        siteUrl: 'https://wc.example.com',
        inventory: { unmanagedStockQuantity: 250, futureKey: 'preserve-me' },
      });
    });

    it('deletes the key when cleared and drops an emptied inventory object', () => {
      const base = {
        siteUrl: 'https://wc.example.com',
        inventory: { unmanagedStockQuantity: 1000 },
      };
      const result = mergeStructuredIntoConfig(base, { unmanagedStockQuantity: '' });
      expect(result).toEqual({ siteUrl: 'https://wc.example.com' });
      expect('inventory' in result).toBe(false);
    });

    it('keeps the inventory object when clearing leaves sibling keys behind', () => {
      const base = { inventory: { unmanagedStockQuantity: 1000, futureKey: 'keep' } };
      const result = mergeStructuredIntoConfig(base, { unmanagedStockQuantity: '' });
      expect(result).toEqual({ inventory: { futureKey: 'keep' } });
    });

    it('leaves inventory untouched when the patch omits the field', () => {
      const base = { inventory: { unmanagedStockQuantity: 1000 } };
      const result = mergeStructuredIntoConfig(base, { siteUrl: 'https://wc.example.com' });
      expect(result).toEqual({
        inventory: { unmanagedStockQuantity: 1000 },
        siteUrl: 'https://wc.example.com',
      });
    });
  });
});

describe('editConnectionSchema — defaultCarrierId (#517)', () => {
  const validRest = {
    name: 'Shop',
    configText: '{}',
  };

  it('accepts an absent value', () => {
    const result = editConnectionSchema.safeParse(validRest);
    expect(result.success).toBe(true);
  });

  it('accepts an empty string (unset signal)', () => {
    const result = editConnectionSchema.safeParse({ ...validRest, defaultCarrierId: '' });
    expect(result.success).toBe(true);
  });

  it.each(['1', '7', '99'])(
    'accepts a positive-integer string (%s)',
    (value) => {
      const result = editConnectionSchema.safeParse({ ...validRest, defaultCarrierId: value });
      expect(result.success).toBe(true);
    },
  );

  it.each(['0', '-1', '7.5', 'abc', '1abc', ' '])(
    'rejects non-positive-integer input (%s) with the documented message',
    (value) => {
      const result = editConnectionSchema.safeParse({ ...validRest, defaultCarrierId: value });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('defaultCarrierId'));
        expect(issue?.message).toBe('Default carrier ID must be a positive integer.');
      }
    },
  );
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

describe('editConnectionSchema — siteUrl (WooCommerce, #975)', () => {
  const validRest = {
    name: 'Shop',
    configText: '{}',
  };

  it('accepts an absent siteUrl and an empty string (unset signal)', () => {
    expect(editConnectionSchema.safeParse(validRest).success).toBe(true);
    expect(editConnectionSchema.safeParse({ ...validRest, siteUrl: '' }).success).toBe(true);
  });

  it('accepts a valid https URL (including https localhost)', () => {
    expect(
      editConnectionSchema.safeParse({ ...validRest, siteUrl: 'https://wc.example.com' }).success,
    ).toBe(true);
    expect(
      editConnectionSchema.safeParse({ ...validRest, siteUrl: 'https://localhost:8443' }).success,
    ).toBe(true);
  });

  it('rejects a plain-http URL with the wizard-aligned message', () => {
    const result = editConnectionSchema.safeParse({
      ...validRest,
      siteUrl: 'http://wc.example.com',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('siteUrl'));
      expect(issue?.message).toBe('Site URL must use HTTPS');
    }
  });
});

describe('editConnectionSchema — unmanagedStockQuantity (WooCommerce, #969 §7.3)', () => {
  const validRest = {
    name: 'Shop',
    configText: '{}',
  };

  it('accepts an absent value and an empty string (unset signal)', () => {
    expect(editConnectionSchema.safeParse(validRest).success).toBe(true);
    expect(
      editConnectionSchema.safeParse({ ...validRest, unmanagedStockQuantity: '' }).success,
    ).toBe(true);
  });

  it.each(['1', '500', '9999'])('accepts a positive-integer string (%s)', (value) => {
    const result = editConnectionSchema.safeParse({
      ...validRest,
      unmanagedStockQuantity: value,
    });
    expect(result.success).toBe(true);
  });

  it.each(['0', '-5', '2.5', 'lots', ' '])(
    'rejects non-positive-integer input (%s) with the documented message',
    (value) => {
      const result = editConnectionSchema.safeParse({
        ...validRest,
        unmanagedStockQuantity: value,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('unmanagedStockQuantity'));
        expect(issue?.message).toBe('Unmanaged stock quantity must be a positive integer.');
      }
    },
  );
});

describe('mergeStructuredIntoConfig — inpostPsModuleType (#767/#1155)', () => {
  it("writes 'official_inpost' to config", () => {
    const result = mergeStructuredIntoConfig({}, { inpostPsModuleType: 'official_inpost' });
    expect(result).toEqual({ inpostPsModuleType: 'official_inpost' });
  });

  it('deletes the key when cleared to empty string', () => {
    const base = {
      inpostPsModuleType: 'official_inpost',
      baseUrl: 'https://shop.example.com',
    };
    const result = mergeStructuredIntoConfig(base, { inpostPsModuleType: '' });
    expect(result).toEqual({ baseUrl: 'https://shop.example.com' });
    expect('inpostPsModuleType' in result).toBe(false);
  });

  it('leaves key untouched when the patch omits it', () => {
    const base = { inpostPsModuleType: 'official_inpost' };
    const result = mergeStructuredIntoConfig(base, { baseUrl: 'https://shop.example.com' });
    expect(result).toEqual({
      inpostPsModuleType: 'official_inpost',
      baseUrl: 'https://shop.example.com',
    });
  });

  it('does not create the key when empty string is patched into an empty config', () => {
    const result = mergeStructuredIntoConfig({}, { inpostPsModuleType: '' });
    expect('inpostPsModuleType' in result).toBe(false);
  });
});

describe('buildEditConnectionSchema / mergeStructuredIntoConfig — plugin contribution seam (#1330)', () => {
  const contribution: ConnectionConfigContribution = {
    schemaShape: {
      acmeToken: z
        .string()
        .refine((v) => v === '' || v.startsWith('acme-'), {
          message: 'Token must start with acme-.',
        })
        .optional(),
    },
    superRefine: (values, ctx) => {
      if (values.acmeToken === 'acme-forbidden') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['acmeToken'],
          message: 'This token is not allowed.',
        });
      }
    },
    readConfigToForm: () => ({}),
    applyToConfig: (config, patch) => {
      const next = { ...config };
      if (typeof patch.acmeToken === 'string') {
        if (patch.acmeToken.length === 0) delete next.token;
        else next.token = patch.acmeToken;
      }
      return next;
    },
  };

  it('composes to the plain base schema when no contribution is supplied', () => {
    const result = buildEditConnectionSchema().safeParse({
      name: 'Base',
      configText: '{}',
    });
    expect(result.success).toBe(true);
    // Static base export and no-contribution composition validate identically.
    expect(editConnectionSchema.safeParse({ name: 'Base', configText: '{}' }).success).toBe(true);
  });

  it('validates plugin fields through the contributed fragment + superRefine', () => {
    const schema = buildEditConnectionSchema(contribution);
    expect(schema.safeParse({ name: 'X', configText: '{}', acmeToken: 'acme-ok' }).success).toBe(
      true,
    );
    expect(schema.safeParse({ name: 'X', configText: '{}', acmeToken: 'nope' }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ name: 'X', configText: '{}', acmeToken: 'acme-forbidden' }).success,
    ).toBe(false);
  });

  it('leaves the config untouched beyond base clauses when no contribution is supplied', () => {
    const result = mergeStructuredIntoConfig(
      { token: 'keep' },
      // The synthetic key is not declaration-merged (test-local contribution),
      // so it needs an explicit widening to the patch type.
      { acmeToken: 'acme-new' } as EditConnectionStructuredPatch,
    );
    expect(result).toEqual({ token: 'keep' });
  });

  it("runs the contribution's applyToConfig as the final assembly pass", () => {
    const result = mergeStructuredIntoConfig(
      { baseUrl: 'https://old.example.com', custom: true },
      { baseUrl: 'https://new.example.com', acmeToken: 'acme-new' } as EditConnectionStructuredPatch,
      contribution,
    );
    expect(result).toEqual({
      baseUrl: 'https://new.example.com',
      custom: true,
      token: 'acme-new',
    });
  });
});
