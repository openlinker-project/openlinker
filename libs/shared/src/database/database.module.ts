/**
 * Database Configuration Module
 *
 * Configures TypeORM connection to PostgreSQL database. Provides async
 * configuration using environment variables for database connection settings.
 *
 * Uses `autoLoadEntities: true` to automatically discover ORM entities registered
 * via `TypeOrmModule.forFeature([...])` in bounded context modules. This avoids
 * breaking domain boundaries by importing entities directly.
 *
 * This module is shared between apps/api and apps/worker to avoid cross-app dependencies.
 *
 * @module libs/shared/src/database
 * @see https://docs.nestjs.com/techniques/database NestJS Database documentation
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_DATABASE', 'openlinker'),
        // Use autoLoadEntities to automatically discover entities registered via
        // TypeOrmModule.forFeature([...]) in bounded context modules.
        // This avoids breaking domain boundaries by importing entities directly.
        autoLoadEntities: true,
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
        logging: configService.get<string>('NODE_ENV') === 'development',
        // Migrations are not configured here because:
        // 1. migrationsRun: false - migrations are not auto-executed at startup
        // 2. Migrations are managed via CLI using apps/api/src/database/data-source.ts
        // 3. At runtime, TypeORM would try to load .ts files which Node.js can't execute
        // Migrations should be run explicitly via CLI before application startup
        migrationsRun: false,
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}

