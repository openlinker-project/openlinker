/**
 * TypeORM DataSource Configuration
 *
 * Standalone DataSource configuration for TypeORM CLI usage. This file is required
 * by the TypeORM CLI to generate and run migrations. It mirrors the database
 * configuration from DatabaseModule but uses environment variables directly
 * (since NestJS ConfigService isn't available in CLI context).
 *
 * This file is separate from DatabaseModule because:
 * 1. TypeORM CLI requires a plain exported DataSource instance
 * 2. NestJS runtime uses TypeOrmModule.forRootAsync with ConfigService
 * 3. CLI context doesn't have NestJS dependency injection
 *
 * @module apps/api/src/database
 * @see {@link DatabaseModule} from @openlinker/shared/database for NestJS runtime configuration
 */

import { DataSource } from 'typeorm';
import { apiPluginMigrations } from '../plugin-migrations';

// Load environment variables
// Try to load dotenv if available (optional dependency)
// If dotenv is not installed, rely on environment variables being set
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment -- typeorm CLI requires CommonJS require() for migration glob resolution
  const { config } = require('dotenv') as { config: (options: { path: string }) => { error?: Error } };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment -- typeorm CLI requires CommonJS require() for migration glob resolution
  const { resolve } = require('path') as { resolve: (...paths: string[]) => string };
  
  // Priority: .env.local > .env (matching NestJS ConfigModule behavior)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- untyped runtime config read at boot
  config({ path: resolve(__dirname, '../../../.env.local') });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- untyped runtime config read at boot
  config({ path: resolve(__dirname, '../../../.env') });
} catch {
  // dotenv not available - rely on environment variables being set
  // This is fine for production where env vars are set by the container/runtime
}

/**
 * TypeORM DataSource for CLI operations
 *
 * Used by TypeORM CLI commands:
 * - typeorm migration:generate
 * - typeorm migration:run
 * - typeorm migration:revert
 * - typeorm migration:show
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'openlinker',
  
  // Entity discovery: all ORM entities from libs/core
  // Note: In compiled JS, this resolves to dist/libs/core/src/**/*.orm-entity.js
  entities: [
    __dirname + '/../../../../libs/core/src/**/*.orm-entity{.ts,.js}',
  ],
  
  // Migration discovery: core migrations from apps/api/src/migrations,
  // plus plugin-owned migrations from `apiPluginMigrations` (#599).
  // Note: In compiled JS, the core glob resolves to dist/apps/api/src/migrations/**/*.js;
  // plugin globs resolve to their respective `dist/migrations/**/*.js` via the
  // `{.ts,.js}` alternation.
  migrations: [
    __dirname + '/../migrations/**/*{.ts,.js}',
    ...apiPluginMigrations,
  ],
  
  // Migration table name (TypeORM tracks executed migrations here)
  migrationsTableName: 'migrations',
  
  // Disable synchronize - migrations are the source of truth
  synchronize: false,
  
  // Logging (useful for migration debugging)
  logging: process.env.NODE_ENV === 'development',
});

