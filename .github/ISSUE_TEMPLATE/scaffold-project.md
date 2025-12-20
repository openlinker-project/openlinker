---
name: Scaffold Project
about: Set up the initial project structure, configuration files, and development environment
title: 'Scaffold OpenLinker Project'
labels: ['enhancement', 'setup', 'infrastructure']
assignees: ''
---

# Scaffold OpenLinker Project

## Overview

Set up the initial project structure, configuration files, and development environment for OpenLinker following the documented architecture and engineering standards.

## Goals

- Initialize monorepo structure with pnpm workspaces
- Set up NestJS applications and libraries
- Configure TypeScript (strict mode)
- Set up database infrastructure (PostgreSQL + TypeORM)
- Configure Redis for caching and event bus
- Set up testing infrastructure (Jest)
- Configure linting (ESLint) and formatting (Prettier)
- Create initial module structure following hexagonal architecture
- Set up Docker for local development
- Configure basic CI/CD pipeline

## Tasks

### 1. Monorepo Setup

- [ ] Initialize pnpm workspace
  - [ ] Create `pnpm-workspace.yaml`
  - [ ] Create root `package.json` with workspace configuration
  - [ ] Set up workspace scripts (build, test, lint, format)

### 2. Project Structure

- [ ] Create directory structure:
  ```
  openlinker/
  ├── apps/
  │   ├── api/                    # Main NestJS API application
  │   └── worker/                 # Background workers (future)
  ├── libs/
  │   ├── core/                   # Core bounded contexts
  │   │   ├── products/
  │   │   ├── inventory/
  │   │   ├── orders/
  │   │   ├── listings/
  │   │   ├── identifier-mapping/
  │   │   ├── sync/
  │   │   └── events/
  │   ├── shared/                 # Shared utilities
  │   │   ├── logging/
  │   │   ├── config/
  │   │   ├── errors/
  │   │   └── types/
  │   └── integrations/           # External integrations (optional)
  ├── docs/                       # Documentation (already exists)
  └── .github/                    # GitHub workflows
  ```

### 3. NestJS API Application (`apps/api`)

- [ ] Initialize NestJS application
  - [ ] Create `apps/api/package.json`
  - [ ] Set up `apps/api/src/main.ts` with basic NestJS bootstrap
  - [ ] Create `apps/api/src/app.module.ts`
  - [ ] Configure environment variables (`.env.example`, `.env`)
  - [ ] Set up configuration module using `@nestjs/config`

### 4. TypeScript Configuration

- [ ] Create root `tsconfig.json` with strict mode settings
- [ ] Create `tsconfig.base.json` for shared compiler options
- [ ] Create project-specific `tsconfig.json` files:
  - [ ] `apps/api/tsconfig.json`
  - [ ] `libs/core/tsconfig.json`
  - [ ] `libs/shared/tsconfig.json`
- [ ] Ensure all configs use strict mode as per engineering standards

### 5. Database Setup (PostgreSQL + TypeORM)

- [ ] Install TypeORM dependencies (`@nestjs/typeorm`, `typeorm`, `pg`)
- [ ] Create database configuration module
- [ ] Set up TypeORM connection configuration
- [ ] Create initial database migration structure
- [ ] Add database connection to `apps/api/src/app.module.ts`
- [ ] Create `.env.example` with database connection variables

### 6. Redis Setup

- [ ] Install Redis client (`@nestjs/redis`, `redis`)
- [ ] Create Redis configuration module
- [ ] Set up Redis connection for caching
- [ ] Prepare Redis Streams setup for event bus (initial structure)
- [ ] Add Redis connection to `apps/api/src/app.module.ts`

### 7. Core Libraries Setup

- [ ] Create `libs/core/package.json`
- [ ] Create `libs/shared/package.json`
- [ ] Set up basic module structure for each bounded context:
  - [ ] Products module skeleton
  - [ ] Inventory module skeleton
  - [ ] Orders module skeleton
  - [ ] Listings module skeleton
  - [ ] Identifier Mapping module skeleton
  - [ ] Sync module skeleton
  - [ ] Events module skeleton
- [ ] Each module should follow hexagonal architecture structure:
  ```
  {domain}/
  ├── domain/
  │   ├── entities/
  │   ├── value-objects/
  │   ├── domain-services/
  │   ├── domain-events/
  │   └── ports/
  ├── application/
  │   ├── use-cases/
  │   ├── services/
  │   └── dto/
  ├── infrastructure/
  │   ├── persistence/
  │   ├── adapters/
  │   └── mappers/
  └── interfaces/
      ├── http/
      ├── events/
      └── dto/
  ```

### 8. Shared Library Setup

- [ ] Create logging module (`libs/shared/src/logging/`)
  - [ ] Logger wrapper/utility
  - [ ] Export from `libs/shared/src/index.ts`
- [ ] Create config utilities (`libs/shared/src/config/`)
- [ ] Create error handling utilities (`libs/shared/src/errors/`)
- [ ] Create common types (`libs/shared/src/types/`)

### 9. Authentication & Authorization

- [ ] Install JWT dependencies (`@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`)
- [ ] Create auth module structure (`apps/api/src/auth/`)
- [ ] Set up JWT strategy (skeleton)
- [ ] Create auth guards
- [ ] Add auth configuration to `.env.example`

### 10. Testing Infrastructure

- [ ] Install Jest and testing dependencies
  - [ ] `jest`, `@nestjs/testing`, `@types/jest`
- [ ] Create root `jest.config.js`
- [ ] Create project-specific Jest configs
- [ ] Set up test scripts in `package.json`
- [ ] Create example test file following testing standards

### 11. Linting & Formatting

- [ ] Install ESLint dependencies
  - [ ] `@nestjs/eslint-config-nestjs`
  - [ ] `@typescript-eslint/eslint-plugin`
  - [ ] `@typescript-eslint/parser`
  - [ ] `eslint-config-prettier`
- [ ] Create `.eslintrc.js` with configuration from engineering standards
- [ ] Install Prettier dependencies
  - [ ] `prettier`, `eslint-config-prettier`
- [ ] Create `.prettierrc` with configuration from engineering standards
- [ ] Create `.prettierignore`
- [ ] Add lint and format scripts to `package.json`

### 12. Git Hooks (Husky)

- [ ] Install Husky dependencies
  - [ ] `husky`, `lint-staged` (optional, for staged files only)
- [ ] Initialize Husky (`pnpm exec husky install`)
- [ ] Create `.husky/pre-commit` hook that runs:
  - [ ] Linting check (`pnpm lint`)
  - [ ] Type checking (`pnpm type-check` or `tsc --noEmit`)
  - [ ] Tests (`pnpm test`)
- [ ] Configure hook to fail commit if any check fails
- [ ] Add `prepare` script to root `package.json` to auto-install Husky
- [ ] Document Husky setup in `CONTRIBUTING.md`

### 13. Docker Setup

- [ ] Create `Dockerfile` for API application
- [ ] Create `docker-compose.yml` with:
  - [ ] PostgreSQL service
  - [ ] Redis service
  - [ ] API application service
- [ ] Create `.dockerignore`
- [ ] Add Docker-related scripts to `package.json`

### 14. CI/CD Setup

- [ ] Create `.github/workflows/ci.yml`:
  - [ ] Install dependencies
  - [ ] Lint check
  - [ ] Type check
  - [ ] Run tests
  - [ ] Build check
- [ ] Create `.github/workflows/cd.yml` (skeleton for future deployment)

### 15. Documentation

- [ ] Create `CONTRIBUTING.md` with setup instructions
- [ ] Update `README.md` with:
  - [ ] Project description
  - [ ] Prerequisites
  - [ ] Installation instructions
  - [ ] Development setup
  - [ ] Running the application
  - [ ] Testing
  - [ ] Links to architecture docs
- [ ] Create `.gitignore` with appropriate patterns

### 16. Environment Configuration

- [ ] Create `.env.example` with all required environment variables:
  - [ ] Database connection (PostgreSQL)
  - [ ] Redis connection
  - [ ] JWT secrets
  - [ ] API port
  - [ ] Environment (development/production)
- [ ] Document all environment variables

### 17. Initial Module Implementation

- [ ] Implement basic `IdentifierMappingService` structure:
  - [ ] Domain entity
  - [ ] Port interface
  - [ ] TypeORM entity
  - [ ] Repository
  - [ ] Service implementation
  - [ ] Module setup
- [ ] This is the first core service needed by all adapters

## Acceptance Criteria

- [ ] Project can be cloned and set up with `pnpm install`
- [ ] API application starts successfully with `pnpm start:dev`
- [ ] Database connection works (PostgreSQL)
- [ ] Redis connection works
- [ ] All TypeScript files compile without errors (strict mode)
- [ ] Linting passes with no errors
- [ ] Formatting is consistent
- [ ] Tests can be run (even if empty test suites)
- [ ] Pre-commit hooks run successfully (linting and tests on commit)
- [ ] Docker Compose starts all services successfully
- [ ] CI pipeline passes
- [ ] Documentation is complete and accurate

## Technical Requirements

### TypeScript
- Strict mode enabled
- All compiler options from engineering standards
- No `any` types (use `unknown` if needed)

### NestJS
- Latest stable version
- Proper module structure
- Dependency injection throughout

### Database
- PostgreSQL 14+
- TypeORM with proper entity definitions
- Migration support

### Code Quality
- ESLint configured per engineering standards
- Prettier configured per engineering standards
- All code follows naming conventions

## Dependencies to Install

### Core
- `@nestjs/core`
- `@nestjs/common`
- `@nestjs/config`
- `@nestjs/platform-express`
- `@nestjs/typeorm`
- `typeorm`
- `pg`
- `@nestjs/redis`
- `redis`

### Authentication
- `@nestjs/jwt`
- `@nestjs/passport`
- `passport`
- `passport-jwt`

### Validation
- `class-validator`
- `class-transformer`

### Testing
- `jest`
- `@nestjs/testing`
- `@types/jest`
- `ts-jest`

### Development
- `typescript`
- `ts-node`
- `@types/node`
- `nodemon` (or use NestJS CLI)

### Git Hooks
- `husky`
- `lint-staged` (optional, for staged files only)

## Notes

- Follow all conventions from [Engineering Standards](../docs/engineering-standards.md)
- Maintain hexagonal architecture structure from [Architecture Overview](../docs/architecture-overview.md)
- Keep domain layer free of framework dependencies
- All services must implement interfaces
- Types must be in separate `*.types.ts` files
- Interfaces and implementations must be in separate files

## Related Documentation

- [Architecture Overview](../docs/architecture-overview.md)
- [Engineering Standards](../docs/engineering-standards.md)
- [AI Assistant Guide](../docs/ai-assistant-guide.md)

