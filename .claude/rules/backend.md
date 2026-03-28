---
paths:
  - "apps/api/**"
  - "apps/worker/**"
  - "libs/core/**"
  - "libs/integrations/**"
---

# Backend Rules

## Architecture (Hexagonal)

- Domain layer has ZERO framework dependencies — no NestJS, TypeORM, or external imports in `domain/`
- Application services depend on **port interfaces**, never concrete repositories or adapters
- ORM entities live only in `infrastructure/persistence/entities/` — never leak into domain or application layers
- Repository ports are defined in `domain/ports/`, implementations in `infrastructure/persistence/repositories/`
- Inject ports via Symbol tokens (`@Inject(TOKEN)`), not concrete classes

## Services

- All services must implement an interface defined in a separate `*.service.interface.ts` file
- Service interface naming: `I{Purpose}Service`

## Naming

- Ports: `*.port.ts` → class `{Capability}Port`
- Adapters: `*-adapter.ts` → class `{Platform}{Capability}Adapter`
- ORM entities: `*.orm-entity.ts` (not `*.entity.ts` — that's for domain entities)
- Domain entities: `*.entity.ts`
- Types in separate `*.types.ts` files — never inline in implementation files

## Testing

- Unit tests (`*.spec.ts`): mock ports and interfaces, never concrete adapters
- Integration tests (`*.int-spec.ts`): use Testcontainers (real Postgres + Redis), never mock the DB
- Run `pnpm test` for unit tests (no Docker needed)
- Run `pnpm test:integration` for integration tests (requires Docker)

## Quality Gate

Before committing backend changes:
```bash
pnpm lint && pnpm type-check && pnpm test
```

For schema changes also run:
```bash
pnpm --filter @openlinker/api migration:show
```
