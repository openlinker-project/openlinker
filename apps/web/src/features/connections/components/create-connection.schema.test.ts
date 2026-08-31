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
    expect(
      buildCreateConnectionSchema({ requiresCredentials: true }).safeParse(values()).success
    ).toBe(false);
  });

  it('should ACCEPT a submission with no credentials when the adapter declares none', () => {
    expect(
      buildCreateConnectionSchema({ requiresCredentials: false }).safeParse(values()).success
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

  describe('credential-less adapter', () => {
    it('should DROP a credentials JSON stranded from a previously selected platform', () => {
      // React Hook Form keeps a field's value when its input unmounts (no
      // `shouldUnregister`), so an operator who typed credentials for
      // PrestaShop and then switched to the OMS leaves the value in form
      // state — invisibly, since the input is no longer rendered. The relaxed
      // schema drops the exactly-one-of refine, so nothing complains either.
      //
      // Submitting it would make `ConnectionService.create` take its
      // `if (credentials)` branch: encrypt and persist a credential row nothing
      // ever reads, report `credentialsBacked: true` for a connection that
      // holds none, and hand `updateCredentials` its db-backed branch — the
      // exact state the create guard's own comment says must never happen.
      const input = toCreateConnectionInput(values({ credentialsJson: '{"apiKey":"stranded"}' }), {
        requiresCredentials: false,
      });

      expect('credentials' in input).toBe(false);
      expect('credentialsRef' in input).toBe(false);
    });

    it('should DROP a stranded credentialsRef too', () => {
      const input = toCreateConnectionInput(values({ credentialsRef: 'db:stranded' }), {
        requiresCredentials: false,
      });

      expect('credentialsRef' in input).toBe(false);
      expect('credentials' in input).toBe(false);
    });

    it('should still send credentials when the adapter DOES require them', () => {
      // The option must not change behaviour for every other adapter.
      const input = toCreateConnectionInput(values({ credentialsJson: '{"apiKey":"x"}' }), {
        requiresCredentials: true,
      });
      expect(input.credentials).toEqual({ apiKey: 'x' });
    });
  });
});
