/**
 * AllegroConnectionConfigShapeValidatorAdapter — unit tests
 *
 * Migrated from the pre-#587 `apps/api/.../util/connection-config-validators.spec.ts`
 * (Allegro slice). Verifies the adapter throws `InvalidConnectionConfigException`
 * (a core domain exception, NOT NestJS `BadRequestException`) on shape
 * failure, with the flattened error list intact.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { AllegroConnectionConfigShapeValidatorAdapter } from '../allegro-connection-config-shape-validator.adapter';

describe('AllegroConnectionConfigShapeValidatorAdapter', () => {
  const validator = new AllegroConnectionConfigShapeValidatorAdapter();

  it('accepts a minimal valid config (environment only)', async () => {
    await expect(validator.validate({ environment: 'sandbox' })).resolves.toBeUndefined();
  });

  it('accepts a config with optional fields populated', async () => {
    await expect(
      validator.validate({
        environment: 'production',
        apiBaseUrl: 'https://api.allegro.pl',
        masterCatalogConnectionId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid environment value', async () => {
    await expect(validator.validate({ environment: 'staging' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('rejects a malformed UUID on masterCatalogConnectionId', async () => {
    await expect(
      validator.validate({ environment: 'sandbox', masterCatalogConnectionId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('carries the flattened error list and plugin name on the exception', async () => {
    try {
      await validator.validate({ environment: 'staging' });
      fail('expected InvalidConnectionConfigException');
    } catch (error) {
      const exception = error as InvalidConnectionConfigException;
      expect(exception).toBeInstanceOf(InvalidConnectionConfigException);
      expect(exception.pluginName).toBe('Allegro');
      expect(exception.errors.length).toBeGreaterThan(0);
      expect(exception.errors[0].path).toBe('environment');
    }
  });

  it('accepts unknown keys (the JSONB blob may carry adjacent fields)', async () => {
    // `whitelist: false` — the validator enforces shape on what the DTO
    // describes, not exhaustive ownership of the blob.
    await expect(
      validator.validate({ environment: 'sandbox', futureTunable: 'whatever' }),
    ).resolves.toBeUndefined();
  });
});
