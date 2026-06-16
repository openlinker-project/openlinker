/**
 * Application Bootstrap
 *
 * Main entry point for the OpenLinker API application. Initializes the NestJS
 * application, configures global middleware (CORS, validation), sets up Swagger
 * documentation, and starts the HTTP server.
 *
 * @module apps/api/src
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { installNestLogger } from '@openlinker/shared/logging/nest';
import { AppModule } from './app.module';
import { CapabilityNotSupportedFilter } from './common/filters/capability-not-supported.filter';
import { ConnectionExceptionFilter } from './common/filters/connection-exception.filter';

async function bootstrap(): Promise<void> {
  // Route shared `Logger` calls through @nestjs/common before any other work,
  // so module-init logs land in Nest's formatter from the very first emission.
  installNestLogger();

  // Disable Nest's default body parser so we can control parser order
  // This ensures webhook routes capture raw body before JSON parsing
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  // 1) Webhooks: JSON parser with verify hook to capture raw bytes for signature verification
  // This MUST run before any other body parser to ensure verify hook fires
  app.use(
    '/webhooks',
    express.json({
      limit: '256kb',
      verify: (req: express.Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
        // Capture raw body bytes before JSON parsing
        req.rawBody = buf;
      },
    }),
  );

  // 2) Everything else: normal JSON parser (no raw capture needed)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Cookie parser — required for refresh-token rotation (#710) so the
  // /auth/refresh + /auth/logout handlers can read ol_refresh / ol_csrf.
  app.use(cookieParser());

  // CORS — credentials-aware (refresh-cookie + Authorization round-trip).
  // The wildcard origin is incompatible with `credentials: true` per the
  // CORS spec, so an explicit allow-list is required. `OL_CORS_ORIGIN`
  // is a comma-separated list; defaults to the Vite dev port for local
  // setups, prod deploys must set it.
  const configService = app.get(ConfigService);
  const allowedOrigins = configService
    .get<string>('OL_CORS_ORIGIN', 'http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Map capability + connection-lifecycle domain errors to accurate HTTP
  // statuses instead of the default 500 (#1087). Filters catch disjoint
  // exception types, so registration order is irrelevant.
  app.useGlobalFilters(new CapabilityNotSupportedFilter(), new ConnectionExceptionFilter());

  // Swagger API documentation
  const config = new DocumentBuilder()
    .setTitle('OpenLinker API')
    .setDescription('Open-source, modular, API-first e-commerce orchestration platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('connections', 'Connection management endpoints')
    .addTag('adapters', 'Adapter discovery endpoints')
    .addTag('allegro', 'Allegro integration endpoints (OAuth, validation)')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0'; // Bind to all interfaces (accessible from Docker)
  await app.listen(port, host);

  // eslint-disable-next-line no-console -- bootstrap log: emits before LoggerPort backend is installed
  console.log(`Application is running on: http://localhost:${port}`);
  // eslint-disable-next-line no-console -- bootstrap log: emits before LoggerPort backend is installed
  console.log(`Swagger documentation available at: http://localhost:${port}/api`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console -- bootstrap log: emits before LoggerPort backend is installed
  console.error('Error starting application:', error);
  process.exit(1);
});

