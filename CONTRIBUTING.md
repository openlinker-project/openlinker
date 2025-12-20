# Contributing to OpenLinker

Thank you for your interest in contributing to OpenLinker! This document provides guidelines and instructions for contributing.

## Prerequisites

- Node.js 18+ (LTS recommended)
- pnpm 8+
- PostgreSQL 14+
- Redis 7+

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/openlinker.git
   cd openlinker
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   cp apps/api/.env.example apps/api/.env
   # Edit .env with your configuration
   ```

4. **Start services with Docker Compose**
   ```bash
   docker-compose up -d postgres redis
   ```

5. **Run database migrations** (when available)
   ```bash
   pnpm migration:run
   ```

6. **Start the development server**
   ```bash
   pnpm start:dev
   ```

## Git Hooks

This project uses Husky for git hooks. The pre-commit hook runs:
- Linting (`pnpm lint`)
- Type checking (`pnpm type-check`)
- Tests (`pnpm test`)

Husky is automatically installed when you run `pnpm install` (via the `prepare` script).

## Code Style

- Follow the [Engineering Standards](./docs/engineering-standards.md)
- Use Prettier for formatting: `pnpm format`
- Run ESLint: `pnpm lint`

## Testing

- Write tests for new features
- Run tests: `pnpm test`
- Run tests in watch mode: `pnpm test:watch`
- Check coverage: `pnpm test:cov`

## Architecture

Please review the [Architecture Overview](./docs/architecture-overview.md) before making significant changes.

## Pull Request Process

1. Create a feature branch from `develop`
2. Make your changes following the coding standards
3. Write or update tests
4. Ensure all tests pass and linting is clean
5. Update documentation if needed
6. Submit a pull request with a clear description

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Questions?

Feel free to open an issue for questions or discussions.


