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
- pnpm 8+
- PostgreSQL 14+
- Redis 7+

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
   docker-compose up -d postgres redis
   ```

5. **Start the development server**
   ```bash
   pnpm start:dev
   ```

The API will be available at `http://localhost:3000`

## Development

### Running the Application

```bash
# Development mode (with hot reload)
pnpm start:dev

# Production mode
pnpm start:prod
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

## Docker

### Development

```bash
# Start all services (PostgreSQL, Redis, API)
docker-compose up

# Start services in background
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f api
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

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

[Add your license here]

## Related Documentation

- [Architecture Overview](./docs/architecture-overview.md)
- [Engineering Standards](./docs/engineering-standards.md)
- [AI Assistant Guide](./docs/ai-assistant-guide.md)
