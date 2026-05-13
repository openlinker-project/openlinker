# OpenLinker

Open-source, modular, API-first e-commerce orchestration platform.

## Overview

OpenLinker is designed to synchronize and orchestrate e-commerce operations across multiple platforms (shops, marketplaces, shipping providers, etc.) using a hexagonal architecture pattern.

## Features

- **Modular Architecture**: Clear separation between core domain and integrations
- **Platform Agnostic**: Easy to add new platforms without modifying core logic
- **Event-Driven**: Built-in event bus for asynchronous communication
- **Identifier Mapping**: Centralized identifier mapping between external and internal systems
- **API-First**: RESTful API for all operations

## Prerequisites

- Node.js 18+ (LTS recommended)
- pnpm 10+
- Docker (for the dev stack and integration tests)

The dev stack (`pnpm dev:stack:up`) starts PostgreSQL, Redis, MySQL, and
PrestaShop in containers — you do not need any of those installed locally.

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/SilkSoftwareHouse/openlinker.git
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
   pnpm dev:stack:up
   ```
   
   This starts PostgreSQL, Redis, MySQL, and PrestaShop. For detailed setup instructions, see [Development Environment Guide](./docs/dev-environment.md).

5. **Start the application**

   Run whichever process(es) you need; each binds its own port:
   ```bash
   pnpm start:dev:api      # NestJS API on :3000
   pnpm start:dev:worker   # Background job worker
   pnpm start:dev:web      # React frontend on :5173
   ```

## Development

### Running the Application

```bash
# Development mode (with hot reload) — pick the process(es) you need
pnpm start:dev:api      # NestJS API on :3000
pnpm start:dev:worker   # Background job worker
pnpm start:dev:web      # React frontend on :5173

# Production mode (API)
pnpm start:prod:api
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:cov
```

### Linting and Formatting

```bash
# Run linter
pnpm lint

# Format code
pnpm format

# Check formatting
pnpm format:check

# Type check
pnpm type-check
```

### Building

```bash
# Build all packages
pnpm build
```

## Project Structure

```
openlinker/
├── apps/
│   ├── api/              # Main NestJS API application
│   └── worker/           # Background workers (future)
├── libs/
│   ├── core/             # Core bounded contexts
│   │   ├── products/
│   │   ├── inventory/
│   │   ├── orders/
│   │   ├── listings/
│   │   ├── identifier-mapping/
│   │   ├── sync/
│   │   └── events/
│   └── shared/           # Shared utilities
│       ├── logging/
│       ├── config/
│       ├── errors/
│       └── types/
└── docs/                 # Documentation
```

## Architecture

OpenLinker follows a **Hexagonal Architecture** (Ports and Adapters) pattern. For detailed information, see:

- [Architecture Overview](./docs/architecture-overview.md)
- [Engineering Standards](./docs/engineering-standards.md)
- [AI Assistant Guide](./docs/ai-assistant-guide.md)
- [Development Environment](./docs/dev-environment.md)

## Docker

### Development

The development stack includes PostgreSQL, Redis, MySQL, and PrestaShop. For detailed setup and usage instructions, see [Development Environment Guide](./docs/dev-environment.md).

**Quick commands:**

```bash
# Start all services (PostgreSQL, Redis, MySQL, PrestaShop)
pnpm dev:stack:up

# Stop services
pnpm dev:stack:down

# View logs
pnpm dev:stack:logs

# Check health status
pnpm dev:health
```

### Production

```bash
# Build Docker image
docker build -t openlinker:latest .

# Run container
docker run -p 3000:3000 --env-file .env openlinker:latest
```

## CI/CD

The project includes GitHub Actions workflows for:
- **CI**: Linting, type checking, testing, and building
- **CD**: Deployment (configured per environment)

See `.github/workflows/` for details.

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on the development workflow, coding standards, and pull-request process.

## Security

Found a vulnerability? Please follow the responsible-disclosure process in [SECURITY.md](./SECURITY.md) — do not open a public issue.

## License

OpenLinker is released under the Apache License 2.0. See the [LICENSE](./LICENSE) file for details.

## Related Documentation

- [Architecture Overview](./docs/architecture-overview.md)
- [Engineering Standards](./docs/engineering-standards.md)
- [AI Assistant Guide](./docs/ai-assistant-guide.md)
- [Development Environment](./docs/dev-environment.md)
