/**
 * Database Configuration Module
 *
 * Configures TypeORM connection to PostgreSQL database. Provides async
 * configuration using environment variables for database connection settings.
 * Automatically discovers ORM entities and configures migrations.
 *
 * @module apps/api/src/database
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/infrastructure/persistence/entities/connection.orm-entity';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/infrastructure/persistence/entities/identifier-mapping.orm-entity';

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
        entities: [
          ConnectionOrmEntity,
          IdentifierMappingOrmEntity,
          // Also include any entities from apps/api if they exist
          __dirname + '/../**/*.orm-entity{.ts,.js}',
        ],
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
        logging: configService.get<string>('NODE_ENV') === 'development',
        migrations: [__dirname + '/../migrations/**/*{.ts,.js}'],
        migrationsRun: false,
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}

