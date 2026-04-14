/**
 * Worker Heartbeat Service
 *
 * Writes a timestamped key to Redis every 10 seconds so the API can determine
 * whether the worker is alive. The key carries a Unix-ms timestamp and expires
 * automatically after 120 s — if the worker crashes without a clean shutdown
 * the key expires on its own, causing the health check to flip to error.
 *
 * @module apps/worker/src/health
 */
import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientType } from 'redis';

export const WORKER_HEARTBEAT_KEY = 'openlinker:worker:heartbeat';
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_SECONDS = 120;

@Injectable()
export class WorkerHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private intervalId: NodeJS.Timeout | undefined;

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get<string>('WORKER_HEARTBEAT_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Worker heartbeat disabled via WORKER_HEARTBEAT_ENABLED=false');
      return;
    }

    // Write immediately on startup so the health tile flips to OK quickly.
    void this.writeHeartbeat();
    this.intervalId = setInterval(() => {
      void this.writeHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    this.logger.log(`Worker heartbeat started (interval=${HEARTBEAT_INTERVAL_MS}ms, TTL=${HEARTBEAT_TTL_SECONDS}s)`);
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private async writeHeartbeat(): Promise<void> {
    try {
      await this.redisClient.set(
        WORKER_HEARTBEAT_KEY,
        Date.now().toString(),
        { EX: HEARTBEAT_TTL_SECONDS },
      );
    } catch (error) {
      // Heartbeat failure must not crash the worker — log and continue.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to write worker heartbeat: ${message}`);
    }
  }
}
