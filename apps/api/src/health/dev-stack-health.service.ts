/**
 * Dev Stack Health Service
 *
 * Implements development stack health checking operations. Checks connectivity
 * and health of PostgreSQL, Redis, and PrestaShop services. PrestaShop is
 * treated as an external dependency - if unreachable, returns degraded status
 * rather than error.
 *
 * @module apps/api/src/health
 * @implements {IDevStackHealthService}
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { RedisClientType } from 'redis';
import { IDevStackHealthService } from './dev-stack-health.service.interface';
import {
  InternalHealthResponse,
  DevStackHealthResponse,
  ServiceHealth,
  ServiceStatus,
} from './dev-stack-health.types';

@Injectable()
export class DevStackHealthService implements IDevStackHealthService {
  private readonly logger = new Logger(DevStackHealthService.name);
  private readonly CHECK_TIMEOUT_MS = 5000;
  private readonly HEALTHCHECK_STREAM = 'healthcheck';

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async checkInternalHealth(): Promise<InternalHealthResponse> {
    const services = {
      postgres: await this.checkPostgres(),
      redis: await this.checkRedis(),
    };

    // Determine overall status - internal services only
    const hasError =
      services.postgres.status === 'error' || services.redis.status === 'error';

    const status: 'ok' | 'error' = hasError ? 'error' : 'ok';

    return {
      status,
      services,
      timestamp: new Date().toISOString(),
    };
  }

  async checkDevStackHealth(): Promise<DevStackHealthResponse> {
    const services = {
      postgres: await this.checkPostgres(),
      redis: await this.checkRedis(),
      prestashop: await this.checkPrestaShop(),
    };

    // Determine overall status
    // Priority: internal errors > external errors > all ok
    const hasInternalError =
      services.postgres.status === 'error' || services.redis.status === 'error';
    const hasExternalError = services.prestashop.status === 'error';

    let status: 'ok' | 'degraded' | 'error';
    if (hasInternalError) {
      // Internal services (PostgreSQL, Redis) are down - critical error
      status = 'error';
    } else if (hasExternalError) {
      // Internal services are healthy, but external (PrestaShop) is down - degraded
      status = 'degraded';
    } else {
      // All services (internal + external) are healthy
      status = 'ok';
    }

    return {
      status,
      services,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPostgres(): Promise<ServiceHealth> {
    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('PostgreSQL health check timeout')),
          this.CHECK_TIMEOUT_MS,
        );
      });

      try {
        await Promise.race([this.dataSource.query('SELECT 1'), timeoutPromise]);
        return { status: 'ok' as ServiceStatus };
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`PostgreSQL health check failed: ${errorMessage}`, error);
      return {
        status: 'error' as ServiceStatus,
        message: `PostgreSQL connection failed: ${errorMessage}`,
      };
    }
  }

  private async checkRedis(): Promise<ServiceHealth> {
    try {
      // Test Redis Streams by writing and reading from a dedicated healthcheck stream
      const streamKey = this.HEALTHCHECK_STREAM;
      const timestamp = Date.now().toString();

      // Write test entry with MAXLEN ~ 1 to cap stream size
      // Redis v4 API: xAdd(key, id, fields, options?)
      let timeoutId: NodeJS.Timeout | undefined;
      const addTimeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Redis xAdd timeout')),
          this.CHECK_TIMEOUT_MS,
        );
      });

      try {
        await Promise.race([
          this.redisClient.xAdd(
            streamKey,
            '*',
            { timestamp },
            {
              TRIM: {
                strategy: 'MAXLEN',
                strategyModifier: '~',
                threshold: 1,
              },
            },
          ),
          addTimeoutPromise,
        ]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }

      // Read back to verify Streams are working
      // Redis v4 API: xRead(commands, options?)
      timeoutId = undefined;
      const readTimeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Redis xRead timeout')),
          this.CHECK_TIMEOUT_MS,
        );
      });

      try {
        await Promise.race([
          this.redisClient.xRead(
            [{ key: streamKey, id: '0' }],
            { COUNT: 1 },
          ),
          readTimeoutPromise,
        ]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }

      return { status: 'ok' as ServiceStatus };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Redis health check failed: ${errorMessage}`, error);
      return {
        status: 'error' as ServiceStatus,
        message: `Redis connection or Streams test failed: ${errorMessage}`,
      };
    }
  }

  private async checkPrestaShop(): Promise<ServiceHealth> {
    try {
      const baseUrl = this.configService.get<string>(
        'PRESTASHOP_BASE_URL',
        'http://localhost:8080',
      );

      if (!baseUrl || (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://'))) {
        return {
          status: 'error' as ServiceStatus,
          message: 'Invalid PRESTASHOP_BASE_URL configuration (must start with http:// or https://)',
        };
      }

      // Accept 200 OK or 302 redirect (login redirects are common)
      // Timeout is set in the pipe, not in axios config to avoid double timeout
      const response = await firstValueFrom(
        this.httpService
          .get(baseUrl, {
            validateStatus: (status) => status === 200 || status === 302,
            maxRedirects: 5,
          })
          .pipe(timeout(this.CHECK_TIMEOUT_MS)),
      );

      if (response.status === 200 || response.status === 302) {
        return { status: 'ok' as ServiceStatus };
      }

      return {
        status: 'error' as ServiceStatus,
        message: `PrestaShop returned status ${response.status}`,
      };
    } catch (error) {
      // PrestaShop is external - log but don't treat as critical error
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `PrestaShop health check failed (external dependency): ${errorMessage}`,
      );
      return {
        status: 'error' as ServiceStatus,
        message: 'PrestaShop is unreachable',
      };
    }
  }
}

