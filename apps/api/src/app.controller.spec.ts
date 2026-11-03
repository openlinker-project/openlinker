/**
 * App Controller — Unit Tests
 *
 * Covers the `/health/dev-stack` auth gating fix (#1619 review): the route
 * stays `@Public()`, but the per-connection `name` and diagnostic `message`
 * fields are redacted for a request without a valid bearer token. Also covers
 * the root `/robots.txt` (#3787) over real HTTP, since its value lies in the
 * route shape (version-neutral path, text/plain) rather than the handler body.
 *
 * @module apps/api/src
 */
import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import type { IDevStackHealthService } from './health/dev-stack-health.service.interface';
import type { DevStackHealthResponse } from './health/dev-stack-health.types';
import type { IAppInfoService } from './app-info/app-info.service.interface';
import { APP_INFO_SERVICE_TOKEN } from './app-info/app-info.module';
import { API_VERSION } from './app-info/app-info.types';
import { DEV_STACK_HEALTH_SERVICE_TOKEN } from './health/health.module';

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

  describe('getRobotsTxt', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AppController],
        providers: [
          { provide: AppService, useValue: {} },
          { provide: DEV_STACK_HEALTH_SERVICE_TOKEN, useValue: {} },
          { provide: APP_INFO_SERVICE_TOKEN, useValue: {} },
          { provide: JwtService, useValue: {} },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      // Mirrors main.ts so the test sees the same /v1 default the API ships.
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should disallow all crawling when robots.txt is requested', () => {
      expect(controller.getRobotsTxt()).toBe('User-agent: *\nDisallow: /\n');
    });

    it('should serve robots.txt as plain text at the root, outside /v1', async () => {
      const response = await request(app.getHttpServer()).get('/robots.txt');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/plain/);
      expect(response.text).toBe('User-agent: *\nDisallow: /\n');
    });
  });

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
