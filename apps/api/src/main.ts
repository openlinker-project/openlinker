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
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { CapabilityNotSupportedFilter } from './common/filters/capability-not-supported.filter';

async function bootstrap(): Promise<void> {
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

  // Enable CORS
  app.enableCors();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Map capability-related domain errors to 400 instead of the default 500
  app.useGlobalFilters(new CapabilityNotSupportedFilter());

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

  // eslint-disable-next-line no-console
  console.log(`Application is running on: http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger documentation available at: http://localhost:${port}/api`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Error starting application:', error);
  process.exit(1);
});

