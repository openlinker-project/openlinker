/**
 * Worker Application Bootstrap
 *
 * Main entry point for the OpenLinker Worker application. Initializes the NestJS
 * application and starts background workers for job processing.
 *
 * @module apps/worker/src
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { resolveWorkerRoles } from './roles/worker-role.types';
import { Logger } from '@openlinker/shared/logging';
import { installNestLogger } from '@openlinker/shared/logging/nest';

const logger = new Logger('WorkerBootstrap');

async function bootstrap(): Promise<void> {
  // Route shared `Logger` calls through @nestjs/common before any other work,
  // so even pre-Nest-init failures from this bootstrap land in Nest's formatter.
  installNestLogger();

  // Role selection happens BEFORE module composition (#2279, ADR-051): an
  // unknown role throws here, failing the boot loudly instead of running a
  // worker that silently carries nothing.
  const roles = resolveWorkerRoles(process.env.OL_WORKER_ROLE);

  const app = await NestFactory.createApplicationContext(AppModule.forRoles(roles), {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  logger.log(`Worker application started (roles: ${roles.join(', ')})`);
  logger.log('Background workers are running...');

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.log('SIGTERM received, shutting down gracefully...');
    void app.close().then(() => {
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.log('SIGINT received, shutting down gracefully...');
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

bootstrap().catch((error) => {
  logger.error('Error starting worker application:', error);
  process.exit(1);
});

