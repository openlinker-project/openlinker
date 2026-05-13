# Contributing to OpenLinker

Thank you for your interest in contributing to OpenLinker! This document
provides guidelines and instructions for contributing.

## Setup Checklist

The fastest path from a fresh clone to a green test run:

```bash
git clone https://github.com/SilkSoftwareHouse/openlinker.git
cd openlinker
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev:stack:up
pnpm --filter @openlinker/api migration:run
pnpm test
```

If any step fails, the sections below cover prerequisites, setup, and
troubleshooting in more detail.

## Prerequisites

- Node.js 18+ (LTS recommended)
- pnpm 10+
- Docker (for the dev stack and integration tests)

The dev stack (`pnpm dev:stack:up`) starts PostgreSQL, Redis, MySQL, and
PrestaShop in containers — you do not need any of those installed locally.
Running against a locally-installed Postgres / Redis instead is possible
but undocumented; the supported path is Docker.

## Development Setup

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

4. **Start the development stack**
   ```bash
   pnpm dev:stack:up
   ```
   This brings up PostgreSQL, Redis, MySQL, and PrestaShop. See
   [Development Environment Guide](./docs/dev-environment.md) for details.

5. **Run database migrations**
   ```bash
   pnpm --filter @openlinker/api migration:run
   ```
   See [Database Migrations](./docs/migrations.md) for the full workflow.

6. **Start the application**

   Run whichever process(es) you need; each binds its own port:
   ```bash
   pnpm start:dev:api      # NestJS API on :3000
   pnpm start:dev:worker   # Background job worker
   pnpm start:dev:web      # React frontend on :5173
   ```

## Git Hooks

This project uses Husky for git hooks. The pre-commit hook runs:

- Linting (`pnpm lint`)
- Type checking (`pnpm type-check`)
- Tests (`pnpm test`)

Husky is installed automatically by `pnpm install` (via the `prepare`
script).

## Code Style

- Follow the [Engineering Standards](./docs/engineering-standards.md).
- Format with Prettier: `pnpm format`.
- Lint with ESLint: `pnpm lint`.

## Testing

- Write tests for new features.
- Run unit tests: `pnpm test`.
- Run unit tests in watch mode: `pnpm test:watch`.
- Run with coverage: `pnpm test:cov`.
- Run integration tests (requires Docker): `pnpm test:integration`.

See the [Testing Guide](./docs/testing-guide.md) for the full testing
approach, including the Testcontainers setup.

## Architecture

Please review the [Architecture Overview](./docs/architecture-overview.md)
before making significant changes. OpenLinker follows Hexagonal
Architecture (Ports and Adapters); CORE and Integration packages have
strict boundaries that contributions must respect.

## Pull Request Process

1. Create a feature branch from `main` named after the issue
   (e.g., `657-658-660-oss-launch-docs`).
2. Make your changes following the coding standards.
3. Write or update tests.
4. Ensure `pnpm lint`, `pnpm type-check`, and `pnpm test` all pass.
5. Update documentation if needed.
6. Submit a pull request with a clear description and `Closes #N` in the
   body — issues should be closed by the merged PR, not manually. The
   repo has a [pull-request template](./.github/PULL_REQUEST_TEMPLATE.md)
   that prompts for the essentials.

## Governance

Maintainers, review SLA, who can merge, and the rule that integrations
may be co-maintained by non-core authors are documented in
[GOVERNANCE.md](./GOVERNANCE.md). Major changes to the architectural-
direction docs (`docs/architecture-overview.md`,
`docs/engineering-standards.md`, `docs/frontend-architecture.md`)
require a proposal issue first per that policy.

## Commits

OpenLinker uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

### Developer Certificate of Origin (DCO)

OpenLinker uses the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a Contributor License Agreement (CLA). By contributing, you
certify the statements in the DCO — in short, that you have the right to
submit the work under the project's [Apache 2.0](./LICENSE) license.

Sign off your commits with `git commit -s` so each commit ends with a
`Signed-off-by:` trailer:

```
feat(inventory): add inventory sync service

Signed-off-by: Your Name <you@example.com>
```

Automated DCO enforcement will be turned on once the repository transfer
([#641](https://github.com/SilkSoftwareHouse/openlinker/issues/641))
completes; in the interim, please sign off your commits anyway so the
history is consistent when enforcement starts.

## Security

**Do not file security vulnerabilities as public GitHub issues or pull
requests.** See [SECURITY.md](./SECURITY.md) for the responsible-disclosure
process.

## Questions?

Open a GitHub issue for questions or discussion. For security topics,
follow the process in [SECURITY.md](./SECURITY.md) instead.
