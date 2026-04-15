/**
 * Credential Shape Validator Unit Tests
 *
 * @module apps/api/src/integrations/application/credentials
 */
import { BadRequestException } from '@nestjs/common';
import { validateCredentialsShape } from './credential-shape.validator';

describe('validateCredentialsShape', () => {
  describe('prestashop', () => {
    it('should pass when webserviceApiKey is a non-empty string', () => {
      expect(() =>
        validateCredentialsShape('prestashop', { webserviceApiKey: 'ABC123' }),
      ).not.toThrow();
    });

    it('should throw when webserviceApiKey is missing', () => {
      expect(() =>
        validateCredentialsShape('prestashop', { someOtherField: 'X' }),
      ).toThrow(BadRequestException);
    });

    it('should throw when webserviceApiKey is an empty string', () => {
      expect(() =>
        validateCredentialsShape('prestashop', { webserviceApiKey: '   ' }),
      ).toThrow(BadRequestException);
    });

    it('should throw when webserviceApiKey is not a string', () => {
      expect(() =>
        validateCredentialsShape('prestashop', { webserviceApiKey: 12345 }),
      ).toThrow(BadRequestException);
    });
  });

  describe('unknown platform', () => {
    it('should pass without throwing for unrecognised platforms', () => {
      expect(() =>
        validateCredentialsShape('shopify', { accessToken: 'tok_xyz' }),
      ).not.toThrow();
    });

    it('should pass for allegro (OAuth-managed, no shape enforced)', () => {
      expect(() =>
        validateCredentialsShape('allegro', { accessToken: 'tok', refreshToken: 'ref' }),
      ).not.toThrow();
    });
  });
});
