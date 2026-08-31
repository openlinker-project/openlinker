/**
 * Create-connection schema + input mapper (#2405, ADR-055).
 *
 * @module apps/web/src/features/connections/components
 */
import { describe, expect, it } from 'vitest';
import {
  buildCreateConnectionSchema,
  createConnectionSchema,
  toCreateConnectionInput,
  type CreateConnectionFormSubmission,
} from './create-connection.schema';

const values = (overrides: Partial<CreateConnectionFormSubmission> = {}) =>
  ({
    adapterKey: '',
    configText: '{"locationSetId":"default"}',
    credentialsRef: '',
    credentialsJson: '',
    enabledCapabilities: '',
    name: 'OpenLinker OMS',
    platformType: 'openlinker',
    ...overrides,
  }) as CreateConnectionFormSubmission;

describe('buildCreateConnectionSchema', () => {
  it('should REQUIRE exactly one credential source by default', () => {
    // The pre-#2405 behaviour, unchanged for every credential-requiring
    // adapter — and `createConnectionSchema` is exactly this case.
    expect(createConnectionSchema.safeParse(values()).success).toBe(false);
    expect(buildCreateConnectionSchema().safeParse(values()).success).toBe(false);
    expect(buildCreateConnectionSchema({ requiresCredentials: true }).safeParse(values()).success).toBe(
      false,
    );
  });

  it('should ACCEPT a submission with no credentials when the adapter declares none', () => {
    expect(
      buildCreateConnectionSchema({ requiresCredentials: false }).safeParse(values()).success,
    ).toBe(true);
  });

  it('should still accept exactly one credential source for a credential-less adapter', () => {
    const schema = buildCreateConnectionSchema({ requiresCredentials: false });
    expect(schema.safeParse(values({ credentialsRef: 'db:abc' })).success).toBe(true);
  });
});

describe('toCreateConnectionInput — credential keys', () => {
  it('should OMIT both credential keys when neither field was filled in', () => {
    // The #2405 defect this guards: an untouched RHF text input yields `''`,
    // and sending `credentialsRef: ''` is a 400 at the DTO
    // (`@IsOptional()` skips only null/undefined, so `''` is validated and
    // fails `@IsNotEmpty()` and `@Matches(/^db:/)`) — see
    // `apps/api/src/integrations/http/dto/create-connection.dto.spec.ts`.
    //
    // Asserting KEY ABSENCE, not value: a schema-level test would pass here
    // whether or not the key is emitted, so it could not catch this at all.
    const input = toCreateConnectionInput(values());

    expect('credentialsRef' in input).toBe(false);
    expect('credentials' in input).toBe(false);
  });

  it('should send credentialsRef when one was supplied', () => {
    const input = toCreateConnectionInput(values({ credentialsRef: 'db:abc' }));
    expect(input.credentialsRef).toBe('db:abc');
    expect('credentials' in input).toBe(false);
  });

  it('should send parsed credentials when raw JSON was supplied', () => {
    const input = toCreateConnectionInput(values({ credentialsJson: '{"apiKey":"x"}' }));
    expect(input.credentials).toEqual({ apiKey: 'x' });
    expect('credentialsRef' in input).toBe(false);
  });
});
