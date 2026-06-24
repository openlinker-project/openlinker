/**
 * Subiekt Connection Config Shape Validator — unit tests (#753)
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { SubiektConnectionConfigShapeValidatorAdapter } from '../subiekt-connection-config-shape-validator.adapter';

describe('SubiektConnectionConfigShapeValidatorAdapter', () => {
  const validator = new SubiektConnectionConfigShapeValidatorAdapter('Subiekt');

  it('accepts a valid config (incl. http://192.168.x)', async () => {
    await expect(
      validator.validate({ bridgeBaseUrl: 'http://192.168.1.10:5000', timeoutMs: 30000 }),
    ).resolves.toBeUndefined();
  });

  it('throws InvalidConnectionConfigException for a missing/empty bridgeBaseUrl', async () => {
    await expect(validator.validate({})).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    await expect(validator.validate({ bridgeBaseUrl: '' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('rejects http://metadata.google.internal via the isBridgeUrlSafe constraint', async () => {
    await expect(
      validator.validate({ bridgeBaseUrl: 'http://metadata.google.internal' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('rejects decimal IMDS http://2852039166 via the isBridgeUrlSafe constraint', async () => {
    await expect(
      validator.validate({ bridgeBaseUrl: 'http://2852039166' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('rejects an out-of-range timeoutMs', async () => {
    await expect(
      validator.validate({ bridgeBaseUrl: 'http://192.168.1.10', timeoutMs: 999999 }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });
});
