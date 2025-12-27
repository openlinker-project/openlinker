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
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

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

  // Swagger API documentation
  const config = new DocumentBuilder()
    .setTitle('OpenLinker API')
    .setDescription('Open-source, modular, API-first e-commerce orchestration platform')
    .setVersion('1.0')
    .addTag('connections', 'Connection management endpoints')
    .addTag('adapters', 'Adapter discovery endpoints')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

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

