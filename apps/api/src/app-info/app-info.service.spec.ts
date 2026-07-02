/**
 * App Info Service Unit Tests
 *
 * Covers the product-version resolution chain
 * (OL_PRODUCT_VERSION → npm_package_version → dev fallback) and the API-version
 * constant surface.
 *
 * @module apps/api/src/app-info
 */
import type { ConfigService } from '@nestjs/config';
import { AppInfoService } from './app-info.service';
import { API_VERSION_LABEL } from './app-info.types';

describe('AppInfoService', () => {
  const originalNpmVersion = process.env.npm_package_version;

  function makeService(configValue?: string): AppInfoService {
    const configService = {
      get: jest.fn().mockReturnValue(configValue),
    } as unknown as ConfigService;
    return new AppInfoService(configService);
  }

  afterEach(() => {
    if (originalNpmVersion === undefined) {
      delete process.env.npm_package_version;
    } else {
      process.env.npm_package_version = originalNpmVersion;
    }
  });

  describe('getProductVersion', () => {
    it('should return OL_PRODUCT_VERSION when set', () => {
      delete process.env.npm_package_version;
      const service = makeService('1.4.2');

      expect(service.getProductVersion()).toBe('1.4.2');
    });

    it('should trim whitespace from OL_PRODUCT_VERSION', () => {
      const service = makeService('  2.0.0  ');

      expect(service.getProductVersion()).toBe('2.0.0');
    });

    it('should fall back to npm_package_version when OL_PRODUCT_VERSION is unset', () => {
      process.env.npm_package_version = '0.9.1';
      const service = makeService(undefined);

      expect(service.getProductVersion()).toBe('0.9.1');
    });

    it('should fall back to the dev sentinel when nothing is set', () => {
      delete process.env.npm_package_version;
      const service = makeService(undefined);

      expect(service.getProductVersion()).toBe('0.0.0-dev');
    });

    it('should prefer OL_PRODUCT_VERSION over npm_package_version', () => {
      process.env.npm_package_version = '0.9.1';
      const service = makeService('3.1.0');

      expect(service.getProductVersion()).toBe('3.1.0');
    });

    it('should ignore an empty OL_PRODUCT_VERSION and fall through', () => {
      delete process.env.npm_package_version;
      const service = makeService('   ');

      expect(service.getProductVersion()).toBe('0.0.0-dev');
    });
  });

  describe('getApiVersion', () => {
    it('should return the shared API version label', () => {
      const service = makeService('1.0.0');

      expect(service.getApiVersion()).toBe(API_VERSION_LABEL);
      expect(service.getApiVersion()).toBe('v1');
    });
  });

  describe('getAppInfo', () => {
    it('should combine product and API versions', () => {
      delete process.env.npm_package_version;
      const service = makeService('1.2.3');

      expect(service.getAppInfo()).toEqual({ version: '1.2.3', api: 'v1' });
    });
  });
});
