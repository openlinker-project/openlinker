/**
 * App Controller — Unit Tests
 *
 * Covers the `/health/dev-stack` auth gating fix (#1619 review): the route
 * stays `@Public()`, but the per-connection `name` and diagnostic `message`
 * fields are redacted for a request without a valid bearer token.
 *
 * @module apps/api/src
 */
import type { JwtService } from '@nestjs/jwt';
import { AppController } from './app.controller';
import type { AppService } from './app.service';
import type { IDevStackHealthService } from './health/dev-stack-health.service.interface';
import type { DevStackHealthResponse } from './health/dev-stack-health.types';
import type { IAppInfoService } from './app-info/app-info.service.interface';

function buildHealthResponse(): DevStackHealthResponse {
  return {
    status: 'ok',
    services: {
      postgres: { status: 'ok' },
      redis: { status: 'ok' },
      prestashop: { status: 'ok' },
      worker: { status: 'ok' },
    },
    connections: [
      {
        connectionId: 'conn-1',
        name: 'My WooCommerce Shop',
        platformType: 'woocommerce',
        status: 'error',
        message: 'WooCommerce authentication failed - check consumer key and secret',
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

describe('AppController', () => {
  let controller: AppController;
  let devStackHealthService: jest.Mocked<IDevStackHealthService>;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;

  beforeEach(() => {
    devStackHealthService = {
      checkInternalHealth: jest.fn(),
      checkDevStackHealth: jest.fn().mockResolvedValue(buildHealthResponse()),
    };
    jwtService = {
      verifyAsync: jest.fn(),
    };

    controller = new AppController(
      {} as AppService,
      devStackHealthService,
      { getAppInfo: jest.fn() } as unknown as IAppInfoService,
      jwtService as unknown as JwtService
    );
  });

  function buildRequest(authHeader?: string): { headers: Record<string, string | undefined> } {
    return { headers: { authorization: authHeader } };
  }

  describe('getDevStackHealth', () => {
    it('should return connection name and message when the bearer token is valid', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });

      const result = await controller.getDevStackHealth(
        buildRequest('Bearer valid-token') as never
      );

      expect(result.connections[0]).toEqual({
        connectionId: 'conn-1',
        name: 'My WooCommerce Shop',
        platformType: 'woocommerce',
        status: 'error',
        message: 'WooCommerce authentication failed - check consumer key and secret',
      });
    });

    it('should redact connection name and message when no bearer token is present', async () => {
      const result = await controller.getDevStackHealth(buildRequest(undefined) as never);

      expect(result.connections[0]).toEqual({
        connectionId: 'conn-1',
        platformType: 'woocommerce',
        status: 'error',
      });
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('should redact connection name and message when the bearer token is invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      const result = await controller.getDevStackHealth(
        buildRequest('Bearer garbage') as never
      );

      expect(result.connections[0]).toEqual({
        connectionId: 'conn-1',
        platformType: 'woocommerce',
        status: 'error',
      });
    });
  });
});
