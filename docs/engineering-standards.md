# Engineering Standards

This document defines coding standards, naming conventions, and best practices for the OpenLinker project.

## Table of Contents

1. [Languages & Frameworks](#languages--frameworks)
2. [Naming Conventions](#naming-conventions)
3. [Project Structure](#project-structure)
4. [Coding Standards](#coding-standards)
5. [Testing Standards](#testing-standards)
6. [Git Workflow](#git-workflow)
7. [Code Review Guidelines](#code-review-guidelines)

---

## Languages & Frameworks

### Primary Stack

- **Language**: TypeScript (strict mode)
- **Framework**: NestJS
- **Runtime**: Node.js (LTS version)
- **Package Manager**: pnpm
- **Monorepo**: pnpm workspaces

### TypeScript Configuration

All TypeScript projects must use strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

---

## Naming Conventions

### Files and Folders

#### Domain Layer Files

- **Entities**: `*.entity.ts` (e.g., `product.entity.ts`)
- **Value Objects**: `*.vo.ts` (e.g., `money.vo.ts`)
- **Domain Services**: `*.domain-service.ts` (e.g., `product-mapping.domain-service.ts`)
- **Domain Events**: `*.event.ts` (e.g., `product-created.event.ts`)
- **Ports (Interfaces)**: `*.port.ts` (e.g., `inventory-master.port.ts`) - interface definition only
- **Port sub-capabilities**: `*.capability.ts` (e.g., `offer-creator.capability.ts`) - optional capability interface + co-located `is{Capability}` type-guard. Used when a port has optional methods that can be extracted as distinct composable capabilities; lives under `domain/ports/capabilities/`.
- **Types**: `*.types.ts` (e.g., `product.types.ts`) - type definitions only

#### Application Layer Files

- **Use Cases**: `*.use-case.ts` (e.g., `sync-product.use-case.ts`)
- **Service Interfaces**: `*.service.interface.ts` (e.g., `product-sync.service.interface.ts`)
- **Application Services**: `*.service.ts` (e.g., `product-sync.service.ts`) - implements interface from `*.service.interface.ts`
- **DTOs**: `*.dto.ts` (e.g., `product-sync.dto.ts`)
- **Types**: `*.types.ts` (e.g., `product.types.ts`) - type definitions only

#### Infrastructure Layer Files

- **ORM Entities**: `*.orm-entity.ts` (e.g., `product.orm-entity.ts`)
- **Repositories**: `*.repository.ts` (e.g., `product.repository.ts`)
- **Adapter Interfaces**: `*.adapter.interface.ts` (e.g., `prestashop-inventory-master.adapter.interface.ts`) - interface definition only (if needed)
- **Adapters**: `*.adapter.ts` (e.g., `prestashop-inventory-master.adapter.ts`) - implements port interface
- **Mappers**: `*.mapper.ts` (e.g., `product.mapper.ts`)
- **Types**: `*.types.ts` (e.g., `adapter.types.ts`) - type definitions only

#### Interface Layer Files

- **Controllers**: `*.controller.ts` (e.g., `product.controller.ts`)
- **Request DTOs**: `create-*.dto.ts`, `update-*.dto.ts` (e.g., `create-product.dto.ts`)
- **Response DTOs**: `*-response.dto.ts` (e.g., `product-response.dto.ts`)
- **Event Handlers**: `*-event.handler.ts` (e.g., `product-event.handler.ts`)

#### Test Files

- **Unit Tests**: `*.spec.ts` (e.g., `product.service.spec.ts`)
- **Integration Tests**: `*.int-spec.ts` (e.g., `product.int-spec.ts`) — see [Testing Guide](./testing-guide.md) for the harness pattern
- **E2E Tests**: `*.e2e-spec.ts` (e.g., `product.e2e-spec.ts`)

### Class Names

#### Ports (Interfaces)

- Pattern: `{Capability}Port`
- Examples:
  - `InventoryMasterPort`
  - `OrderProcessorManagerPort`
  - `PricingAuthorityPort`

#### Adapters

- Pattern: `{System}{Capability}Adapter`
- Examples:
  - `PrestashopInventoryMasterAdapter`
  - `PrestashopOrderProcessorAdapter`
  - `AllegroOfferManagerAdapter`
  - `AllegroOrderSourceAdapter`

#### Domain Entities

- Pattern: `{EntityName}` (PascalCase)
- Examples:
  - `Product`
  - `Order`
  - `Inventory`

#### Services

- Pattern: `{Purpose}Service` (PascalCase)
- **Requirement**: Services must always implement an interface
- Interface pattern: `I{Purpose}Service` (e.g., `IProductSyncService`)
- Examples:
  - `ProductSyncService` implements `IProductSyncService`
  - `InventorySyncService` implements `IInventorySyncService`
  - `OrderSyncService` implements `IOrderSyncService`

#### Controllers

- Pattern: `{Resource}Controller` (PascalCase)
- Examples:
  - `ProductController`
  - `OrderController`
  - `InventoryController`

### Variables and Functions

- **Variables**: `camelCase` (e.g., `productId`, `orderStatus`)
- **Functions**: `camelCase` (e.g., `getProduct()`, `syncInventory()`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_ATTEMPTS`, `DEFAULT_PAGE_SIZE`)
- **Private members**: Prefix with `_` if needed for clarity (e.g., `_privateField`)

### Interfaces and Types

- **Interfaces**: `PascalCase` (e.g., `Product`, `OrderCreate`, `IProductSyncService`)
- **Types**: `PascalCase` (e.g., `OrderStatus`, `ProductFilter`)
- **Requirement**: Types must be defined in separate files (`*.types.ts`)
- **Requirement**: Interface definitions and implementations must be in separate files

---

## Project Structure

### Standard Module Structure

Each domain module follows this structure:

```
{domain}/
├── domain/                          # Domain Layer (Pure Business Logic)
│   ├── entities/                    # Domain Entities / Aggregates
│   │   ├── product.entity.ts
│   │   └── product-variant.entity.ts
│   ├── value-objects/               # Value Objects
│   │   ├── money.vo.ts
│   │   └── sku.vo.ts
│   ├── domain-services/             # Domain Services
│   │   └── product-mapping.service.ts
│   ├── domain-events/               # Domain Events
│   │   └── product-created.event.ts
│   └── ports/                       # Ports (Interfaces)
│       ├── inventory-master.port.ts
│       └── order-processor-manager.port.ts
│
├── application/                     # Application Layer (Use Cases)
│   ├── use-cases/                   # Use Case Implementations
│   │   ├── sync-product.use-case.ts
│   │   └── map-product.use-case.ts
│   ├── services/                     # Application Services
│   │   └── product-sync.service.ts
│   └── dto/                         # Application DTOs
│       ├── product-sync.dto.ts
│       └── product-mapping.dto.ts
│
├── infrastructure/                  # Infrastructure Layer
│   ├── persistence/                 # Database
│   │   ├── entities/                # TypeORM Entities
│   │   │   └── product.orm-entity.ts
│   │   └── repositories/            # Repository Implementations
│   │       └── product.repository.ts
│   ├── adapters/                    # External Adapters
│   │   ├── prestashop-inventory-master.adapter.ts
│   │   └── prestashop-order-processor.adapter.ts
│   └── mappers/                     # Data Mappers
│       └── product.mapper.ts
│
└── interfaces/                      # Interface Layer
    ├── http/                        # HTTP Controllers
    │   ├── product.controller.ts
    │   └── product.controller.spec.ts
    ├── events/                      # Event Handlers
    │   └── product-event.handler.ts
    └── dto/                         # Request/Response DTOs
        ├── create-product.dto.ts
        └── product-response.dto.ts
```

### NestJS Module Structure

```typescript
// {domain}.module.ts
@Module({
  imports: [
    TypeOrmModule.forFeature([DomainOrmEntity]),
    // Other modules
  ],
  controllers: [DomainController],
  providers: [
    // Application services
    DomainService,
    // Use cases
    SyncDomainUseCase,
    // Repositories
    DomainRepository,
    // Adapters (if applicable)
    PrestashopDomainAdapter,
    {
      provide: DomainPort,
      useClass: PrestashopDomainAdapter,
    },
  ],
  exports: [DomainService, DomainPort],
})
export class DomainModule {}
```

---

## Coding Standards

### File Headers

**All source files must include a header comment** describing the purpose and context of the file.

✅ **Good**:
```typescript
/**
 * Identifier Mapping Service
 *
 * Provides centralized identifier mapping between external platform identifiers
 * (e.g., PrestaShop product ID, Allegro order ID) and internal OpenLinker identifiers.
 * Ensures all entities in the system have unique internal identifiers from a single
 * unified seed, regardless of their origin platform.
 *
 * @module application/services
 * @see {@link IdentifierMappingPort} for the port interface
 * @see {@link IdentifierMappingRepository} for persistence implementation
 */
```

**Header Requirements**:
- **Purpose**: Brief description of what the file does
- **Context**: Additional context about the file's role in the system
- **Module path** (optional): `@module` tag indicating the module path
- **Related files** (optional): `@see` tags linking to related interfaces, implementations, or documentation

**Header Format**:
```typescript
/**
 * {File Purpose}
 *
 * {Detailed description of the file's purpose and context.}
 * {Additional context if needed.}
 *
 * @module {module/path} (optional)
 * @see {@link RelatedClass} for related functionality (optional)
 */
```

**Examples by Layer**:

**Domain Entity**:
```typescript
/**
 * Identifier Mapping Domain Entity
 *
 * Represents a mapping between an external platform identifier and an internal
 * OpenLinker identifier. This is a core domain entity used across all adapters
 * to maintain consistent identity across platforms.
 *
 * @module domain/entities
 */
```

**Port Interface**:
```typescript
/**
 * Identifier Mapping Port
 *
 * Defines the contract for identifier mapping operations. Implemented by
 * IdentifierMappingService to provide identifier translation capabilities.
 *
 * @module domain/ports
 */
```

**Service Implementation**:
```typescript
/**
 * Identifier Mapping Service
 *
 * Implements identifier mapping operations, providing get-or-create semantics
 * for internal identifiers and bidirectional mapping between external and
 * internal identifiers.
 *
 * @module application/services
 * @implements {IIdentifierMappingService}
 */
```

**Controller**:
```typescript
/**
 * Product Controller
 *
 * HTTP REST API endpoints for product operations. Handles request validation,
 * delegates to application services, and formats responses.
 *
 * @module interfaces/http
 */
```

### Dependency Injection

**Always use dependency injection** instead of static calls or direct instantiation.

✅ **Good**:
```typescript
@Injectable()
export class ProductSyncService {
  constructor(
    private readonly inventoryMaster: InventoryMasterPort,
    private readonly logger: Logger,
  ) {}

  async syncProduct(productId: string) {
    const inventory = await this.inventoryMaster.getInventory(productId);
    // ...
  }
}
```

❌ **Bad**:
```typescript
export class ProductSyncService {
  async syncProduct(productId: string) {
    const adapter = new PrestashopAdapter(); // Direct instantiation
    const inventory = await adapter.getInventory(productId);
  }
}
```

### Service Interface Implementation

**Services must always implement an interface** to ensure testability and loose coupling. **Interface and implementation must be in separate files.**

✅ **Good**:
```typescript
// application/interfaces/product-sync.service.interface.ts
export interface IProductSyncService {
  syncProduct(productId: string): Promise<void>;
}

// application/services/product-sync.service.ts
import { IProductSyncService } from '../interfaces/product-sync.service.interface';

@Injectable()
export class ProductSyncService implements IProductSyncService {
  constructor(
    private readonly inventoryMaster: InventoryMasterPort,
    private readonly logger: Logger,
  ) {}

  async syncProduct(productId: string): Promise<void> {
    const inventory = await this.inventoryMaster.getInventory(productId);
    // ...
  }
}
```

❌ **Bad**:
```typescript
@Injectable()
export class ProductSyncService {
  // ❌ No interface implementation
  async syncProduct(productId: string) {
    // ...
  }
}
```

### Type Definitions in Separate Files

**All types must be defined in separate files** (`*.types.ts`). Types should not be defined inline in service, entity, or other implementation files.

✅ **Good**:
```typescript
// application/types/product-sync.types.ts
export const ProductSyncStatusValues = ['pending', 'syncing', 'completed', 'failed'] as const;
export type ProductSyncStatus = (typeof ProductSyncStatusValues)[number];

export interface ProductSyncOptions {
  forceUpdate: boolean;
  skipMapping: boolean;
}

// application/services/product-sync.service.ts
import { ProductSyncStatus, ProductSyncOptions } from '../types/product-sync.types';

@Injectable()
export class ProductSyncService implements IProductSyncService {
  async syncProduct(productId: string, options?: ProductSyncOptions): Promise<ProductSyncStatus> {
    // ...
  }
}
```

❌ **Bad**:
```typescript
// application/services/product-sync.service.ts
@Injectable()
export class ProductSyncService implements IProductSyncService {
  // ❌ Types defined inline
  type ProductSyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';
  
  async syncProduct(productId: string): Promise<ProductSyncStatus> {
    // ...
  }
}
```

### Union Types: `as const` Pattern (Default)

**For domain constants, status values, and enumerated types, use the `as const` + union type pattern instead of TypeScript enums.**

**Why:**
- **No runtime artifact**: Unions don't emit JavaScript, reducing bundle size
- **Clean wire format**: APIs/events/DB store strings → unions map cleanly
- **Easier across boundaries**: Importing a union type doesn't pull in runtime objects
- **Avoid enum quirks**: No numeric enum reverse-mapping, nominal typing issues, or special runtime behavior
- **Modern default**: Industry standard in 2025 for domain constants that cross API/event/DB boundaries

**Pattern:**
```typescript
// domain/types/capability.types.ts

/**
 * Capability values
 * 
 * Runtime array of all valid capability values. Used for validation,
 * Swagger documentation, and UI dropdowns.
 */
export const CapabilityValues = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'OfferManager',
] as const;

/**
 * Capability type
 * 
 * Derived union type from CapabilityValues. Provides type safety
 * without runtime overhead.
 */
export type Capability = (typeof CapabilityValues)[number];
```

**Usage:**
```typescript
// Type checking
function processCapability(capability: Capability): void {
  // TypeScript knows capability is one of the valid values
}

// Runtime validation
function isValidCapability(value: string): value is Capability {
  return CapabilityValues.includes(value as Capability);
}

// Swagger/API documentation
@ApiProperty({ enum: CapabilityValues })
capability: Capability;
```

✅ **Good**:
```typescript
// domain/types/connection-status.types.ts
export const ConnectionStatusValues = ['active', 'disabled', 'error'] as const;
export type ConnectionStatus = (typeof ConnectionStatusValues)[number];

// domain/types/job-status.types.ts
export const JobStatusValues = ['queued', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JobStatusValues)[number];
```

❌ **Bad**:
```typescript
// ❌ TypeScript enum (avoid for domain constants)
export enum ConnectionStatus {
  Active = 'active',
  Disabled = 'disabled',
  Error = 'error',
}

// ❌ Inline union without runtime array
export type ConnectionStatus = 'active' | 'disabled' | 'error';
// Missing: No runtime array for validation/Swagger
```

**When to use enums (exception):**
- Only when it materially reduces friction (e.g., heavy NestJS Swagger usage)
- Must be documented with a short comment explaining why enum was chosen
- Never use numeric enums
- Never use `const enum` (unless fully controlling the build pipeline and explicitly opting in)

**ESLint Recommendation** (optional enforcement):
```javascript
// eslint.config.mjs
export default [
  {
    rules: {
      "no-restricted-syntax": [
        "warn", // Start with warn, upgrade to error later
        { 
          selector: "TSEnumDeclaration", 
          message: "Avoid TS enums; use `as const` + union types per engineering standards." 
        }
      ]
    }
  }
];
```

### Interface and Implementation Separation

**Interface definitions and implementations must be in separate files.** This applies to:
- Service interfaces and implementations
- Port interfaces (ports are interfaces themselves, adapters are implementations)
- Adapter interfaces (if needed) and adapter implementations

#### Service Interfaces and Implementations

✅ **Good**:
```typescript
// application/interfaces/product-sync.service.interface.ts
export interface IProductSyncService {
  syncProduct(productId: string): Promise<void>;
}

// application/services/product-sync.service.ts
import { IProductSyncService } from '../interfaces/product-sync.service.interface';

@Injectable()
export class ProductSyncService implements IProductSyncService {
  async syncProduct(productId: string): Promise<void> {
    // Implementation
  }
}
```

❌ **Bad**:
```typescript
// application/services/product-sync.service.ts
// ❌ Interface and implementation in the same file
export interface IProductSyncService {
  syncProduct(productId: string): Promise<void>;
}

@Injectable()
export class ProductSyncService implements IProductSyncService {
  async syncProduct(productId: string): Promise<void> {
    // Implementation
  }
}
```

#### Port Interfaces and Adapter Implementations

✅ **Good**:
```typescript
// domain/ports/inventory-master.port.ts
// Port is an interface - contains only interface definition
export interface InventoryMasterPort {
  getInventory(productId: string): Promise<Inventory>;
  adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory>;
}

// infrastructure/adapters/prestashop-inventory-master.adapter.ts
// Adapter implements the port - contains only implementation
import { InventoryMasterPort } from '../../domain/ports/inventory-master.port';

@Injectable()
export class PrestashopInventoryMasterAdapter implements InventoryMasterPort {
  async getInventory(productId: string): Promise<Inventory> {
    // Implementation
  }
  
  async adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory> {
    // Implementation
  }
}
```

❌ **Bad**:
```typescript
// infrastructure/adapters/prestashop-inventory-master.adapter.ts
// ❌ Port interface defined in adapter file
export interface InventoryMasterPort {
  getInventory(productId: string): Promise<Inventory>;
}

@Injectable()
export class PrestashopInventoryMasterAdapter implements InventoryMasterPort {
  async getInventory(productId: string): Promise<Inventory> {
    // Implementation
  }
}
```

### Ports vs. Concrete Implementations

**Always code against ports (interfaces), never concrete implementations.**

✅ **Good**:
```typescript
@Injectable()
export class InventorySyncService {
  constructor(
    private readonly inventoryMaster: InventoryMasterPort, // Port interface
    private readonly integrationsService: IntegrationsService,
  ) {}

  async syncInventory(productId: string) {
    const inventory = await this.inventoryMaster.getInventory(productId);
    // ...
  }
}
```

❌ **Bad**:
```typescript
@Injectable()
export class InventorySyncService {
  constructor(
    private readonly prestashopAdapter: PrestashopAdapter, // Concrete implementation
  ) {}
}
```

### Repository Ports Pattern

**Application services must never depend on concrete infrastructure repositories.** They must depend on repository ports (interfaces) defined in the domain layer.

**Why:**
- Maintains proper dependency direction (application → domain, not application → infrastructure)
- Enables easy testing (mock the port interface)
- Allows swapping implementations (e.g., in-memory repository for tests)
- Follows Dependency Inversion Principle

**Pattern:**

1. **Define repository port in domain layer:**
   ```typescript
   // domain/ports/product-repository.port.ts
   import { Product } from '../entities/product.entity';
   
   export interface ProductRepositoryPort {
     findById(id: string): Promise<Product | null>;
     save(product: Product): Promise<Product>;
     // ... only methods needed by application services
     // Do NOT mirror TypeORM Repository<T> API - keep it minimal
   }
   ```

2. **Implement port in infrastructure layer:**
   ```typescript
   // infrastructure/persistence/repositories/product.repository.ts
   import { ProductRepositoryPort } from '@openlinker/core/products';
   
   @Injectable()
   export class ProductRepository implements ProductRepositoryPort {
     constructor(
       @InjectRepository(ProductOrmEntity)
       private readonly ormRepository: Repository<ProductOrmEntity>,
     ) {}
     
     async findById(id: string): Promise<Product | null> {
       const entity = await this.ormRepository.findOne({ where: { id } });
       return entity ? this.toDomain(entity) : null;
     }
     
     // Private mapping methods
     private toDomain(entity: ProductOrmEntity): Product { ... }
     private toOrm(product: Product): ProductOrmEntity { ... }
   }
   ```

3. **Inject port (not concrete class) in application service:**
   ```typescript
   // application/services/product.service.ts
   import { ProductRepositoryPort } from '@openlinker/core/products';
   
   @Injectable()
   export class ProductService {
     constructor(
       @Inject(PRODUCT_REPOSITORY_TOKEN)
       private readonly repository: ProductRepositoryPort, // ✅ Port interface
     ) {}
   }
   ```

4. **Bind in module with symbol token:**
   ```typescript
   // product.module.ts
   export const PRODUCT_REPOSITORY_TOKEN = Symbol('ProductRepositoryPort');
   
   @Module({
     providers: [
       ProductRepository,
       {
         provide: PRODUCT_REPOSITORY_TOKEN,
         useExisting: ProductRepository,
       },
     ],
   })
   ```
   
   **Why Symbol tokens?**
   - **Type-safe**: TypeScript can track token usage
   - **Refactor-safe**: Renaming Symbol constant updates all usages
   - **Collision-resistant**: Symbols are unique, preventing accidental token collisions
   - **Exported**: Token is exported from module for use in tests and other modules
   
   ❌ **Avoid string tokens:**
   ```typescript
   // ❌ Fragile: string literals can collide and are hard to refactor
   @Inject('ProductRepositoryPort')
   ```

   See [Symbol DI Token Re-export Convention](#symbol-di-token-re-export-convention) for the file-layout + barrel-export rules every context follows.

✅ **Good:**
```typescript
// Service depends on port interface
import { ProductRepositoryPort } from '@openlinker/core/products';

@Injectable()
export class ProductService {
  constructor(
    @Inject(PRODUCT_REPOSITORY_TOKEN)
    private readonly repository: ProductRepositoryPort, // ✅ Port
  ) {}
}
```

❌ **Bad:**
```typescript
// Service imports concrete infrastructure repository
import { ProductRepository } from '../infrastructure/persistence/repositories/product.repository';

@Injectable()
export class ProductService {
  constructor(
    private readonly repository: ProductRepository, // ❌ Concrete class
  ) {}
}
```

### Symbol DI Token Re-export Convention

**Symbol tokens are used for every kind of DI binding** — repository ports, service interfaces, port interfaces, message-bus producers. The token-layout rule applies uniformly across all of them, not just repository ports.

**Rules (#595):**

1. **Every context owns a `<ctx>/<ctx>.tokens.ts` file.** All Symbol tokens for the context live there — `libs/core/src/inventory/inventory.tokens.ts`, `libs/core/src/listings/listings.tokens.ts`, etc.
2. **The context sub-barrel does `export * from './<ctx>.tokens';`** — never cherry-pick a subset. A new token added to `<ctx>.tokens.ts` is automatically available on `@openlinker/core/<ctx>`; the sub-barrel needs no second edit.
3. **External consumers import tokens only from the top-level barrel** `@openlinker/core/<ctx>`. Deep paths like `@openlinker/core/<ctx>/<ctx>.tokens` are ESLint-blocked in `libs/integrations/**`, `libs/core/**/domain/ports/**`, and `apps/{api,worker}/**`.
4. **Same-context relative imports stay relative.** Inside `libs/core/src/<ctx>/**`, importing `../../<ctx>.tokens` (depth ≤ `../..`) is permitted; the deep-path ESLint rule above matches against the `@openlinker/core/*` prefix and doesn't fire on relative paths.
5. **Token-naming convention**: `{CONTEXT}_{INTERFACE}_TOKEN` — e.g. `INVENTORY_REPOSITORY_TOKEN`, `OFFER_LINKING_SERVICE_TOKEN`, `IDENTIFIER_MAPPING_PORT_TOKEN`. Symbol description matches the underlying interface name (`Symbol('InventoryRepositoryPort')`).
6. **`<ctx>.tokens.ts` files must contain only `export const <NAME>_TOKEN = Symbol(...);` declarations.** Non-Symbol exports (types, helpers, constants) belong in `<ctx>.types.ts` or another dedicated file — `export *` from the tokens file in the sub-barrel would otherwise widen the public surface unintentionally.

✅ **Good:**
```typescript
// libs/core/src/inventory/inventory.tokens.ts — token-only
export const INVENTORY_REPOSITORY_TOKEN = Symbol('InventoryRepositoryPort');
export const INVENTORY_SYNC_SERVICE_TOKEN = Symbol('IInventorySyncService');

// libs/core/src/inventory/index.ts — sub-barrel
export * from './inventory.tokens';

// External consumer
import { INVENTORY_REPOSITORY_TOKEN } from '@openlinker/core/inventory';
```

❌ **Bad:**
```typescript
// Cherry-pick in the sub-barrel — fragile (new tokens silently drop off)
export { INVENTORY_REPOSITORY_TOKEN } from './inventory.tokens';

// Deep import from outside the context — ESLint error, fails at runtime under #591
import { INVENTORY_REPOSITORY_TOKEN } from '@openlinker/core/inventory/inventory.tokens';

// Non-Symbol export sneaks through the star — widens public surface
// (inside <ctx>.tokens.ts)
export type TokenKey = '…';   // ❌ move to <ctx>.types.ts
```

---

### ORM ↔ Domain Mapping

**Mapping between ORM entities and domain entities must live in the infrastructure persistence layer.** Application services work only with domain entities, never ORM entities.

**Rules:**
1. **Mapping is private in repository** (default approach)
2. **Extract to mapper module** only if mapping is reused in multiple places
3. **Application services never touch ORM entities**

**Option A (Default): Keep mapping private in repository**

```typescript
// infrastructure/persistence/repositories/product.repository.ts
@Injectable()
export class ProductRepository implements ProductRepositoryPort {
  async findById(id: string): Promise<Product | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }
  
  // Private mapping methods
  private toDomain(entity: ProductOrmEntity): Product {
    return new Product(
      entity.id,
      entity.name,
      entity.sku,
      // ... map all fields
    );
  }
  
  private toOrm(product: Product): ProductOrmEntity {
    const entity = new ProductOrmEntity();
    entity.id = product.id;
    entity.name = product.name;
    // ... map all fields
    return entity;
  }
}
```

**Option B (Only if reused): Extract to mapper module**

```typescript
// infrastructure/persistence/mappers/product.mapper.ts
export const ProductMapper = {
  toDomain(entity: ProductOrmEntity): Product {
    return new Product(
      entity.id,
      entity.name,
      entity.sku,
    );
  },
  
  toOrm(product: Product): ProductOrmEntity {
    const entity = new ProductOrmEntity();
    entity.id = product.id;
    entity.name = product.name;
    return entity;
  },
};
```

✅ **Good:**
```typescript
// Repository handles mapping internally
async findById(id: string): Promise<Product | null> {
  const entity = await this.ormRepository.findOne({ where: { id } });
  return entity ? this.toDomain(entity) : null; // Returns domain entity
}
```

❌ **Bad:**
```typescript
// Service works with ORM entities
const ormEntity = await this.repository.findOrmEntity(id); // ❌
const product = this.mapToDomain(ormEntity); // ❌ Mapping in service
```

### Domain Layer Independence

**Domain layer must NOT depend on NestJS or any framework code.**

✅ **Good**:
```typescript
// domain/entities/product.entity.ts
export class Product {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly sku: string,
  ) {}
}
```

❌ **Bad**:
```typescript
// domain/entities/product.entity.ts
import { Entity, Column } from 'typeorm'; // ❌ Framework dependency in domain

@Entity()
export class Product {
  @Column()
  id: string;
}
```

### Error Handling

**Use custom exceptions** for domain errors, standard exceptions for infrastructure errors.

**Domain exceptions** should be defined in `domain/exceptions/` directory:

```typescript
// domain/exceptions/product-not-found.exception.ts
export class ProductNotFoundException extends Error {
  constructor(productId: string) {
    super(`Product not found: ${productId}`);
    this.name = 'ProductNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}

// Usage
if (!product) {
  throw new ProductNotFoundException(productId);
}
```

**Repository error handling pattern:**

Repositories must **convert infrastructure errors to domain errors**. Never expose infrastructure-specific error types (TypeORM, database) through ports.

✅ **Good:**
```typescript
// Repository catches infrastructure error and throws domain error
@Injectable()
export class ProductRepository implements ProductRepositoryPort {
  async insertMapping(mapping: IdentifierMapping): Promise<IdentifierMapping> {
    try {
      const saved = await this.ormRepository.save(this.toOrm(mapping));
      return this.toDomain(saved);
    } catch (error) {
      // Convert infrastructure error to domain error
      if (error instanceof QueryFailedError && error.message.includes('duplicate key')) {
        throw new DuplicateIdentifierMappingError(
          mapping.entityType,
          mapping.externalId,
          mapping.platformType,
          mapping.connectionId,
        );
      }
      throw error;
    }
  }
}
```

❌ **Bad:**
```typescript
// Repository port exposes infrastructure-specific error checking
export interface ProductRepositoryPort {
  isUniqueViolationError(error: unknown): boolean; // ❌ Infrastructure-specific
}

// Repository throws infrastructure error
catch (error) {
  if (error instanceof QueryFailedError) {
    throw error; // ❌ Infrastructure error leaks to application
  }
}
```

**Handle errors at the application layer**:

```typescript
@Injectable()
export class ProductService {
  async getProduct(productId: string): Promise<Product> {
    try {
      return await this.repository.findById(productId);
    } catch (error) {
      if (error instanceof ProductNotFoundException) {
        throw error; // Re-throw domain exceptions
      }
      this.logger.error('Failed to get product', error);
      throw new InternalServerErrorException('Failed to retrieve product');
    }
  }
}
```

**Error handling in concurrent operations:**

For concurrency-safe operations (e.g., get-or-create), catch domain errors and retry:

```typescript
@Injectable()
export class IdentifierMappingService {
  async getOrCreateInternalId(...): Promise<string> {
    try {
      await this.repository.insertMapping(mapping);
      return internalId;
    } catch (error) {
      // Handle domain error (not infrastructure error)
      if (error instanceof DuplicateIdentifierMappingError) {
        // Retry: select and return winner
        const winner = await this.repository.findByExternalKey(...);
        return winner.internalId;
      }
      throw error;
    }
  }
}
```

### Nullability

**Use strict null checks** and handle null/undefined explicitly.

✅ **Good**:
```typescript
async getProduct(productId: string): Promise<Product | null> {
  const product = await this.repository.findById(productId);
  if (!product) {
    return null;
  }
  return product;
}
```

❌ **Bad**:
```typescript
async getProduct(productId: string): Promise<Product> {
  return await this.repository.findById(productId); // May return null
}
```

### Logging

**Use the `Logger` factory** from `@openlinker/shared/logging`. It implements the framework-neutral `LoggerPort` contract; the active backend is swapped at host boot (Nest in apps, console default everywhere else).

```typescript
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  async syncProduct(productId: string) {
    this.logger.log(`Syncing product: ${productId}`);
    try {
      // ...
      this.logger.log(`Product synced successfully: ${productId}`);
    } catch (error) {
      this.logger.error(`Failed to sync product: ${productId}`, (error as Error).stack);
      throw error;
    }
  }
}
```

**Host wiring** (apps/api, apps/worker only):

```typescript
import { installNestLogger } from '@openlinker/shared/logging/nest';

async function bootstrap() {
  installNestLogger(); // first statement — routes every Logger call through @nestjs/common
  // ...
}
```

Library code and plugins must NOT import from `@openlinker/shared/logging/nest`. The neutral `@openlinker/shared/logging` ships its own console-based default, so `new Logger(ctx)` works zero-config.

**Log levels** (from `LogLevelValues` / `LogLevel`):
- `log()`: General information
- `debug()`: Detailed debugging information
- `warn()`: Warnings
- `error(message, stack?, context?)`: Errors with optional stack traces

### Async/Await

**Always use async/await** instead of Promises with `.then()`.

✅ **Good**:
```typescript
async syncProduct(productId: string): Promise<void> {
  const product = await this.repository.findById(productId);
  const inventory = await this.inventoryMaster.getInventory(productId);
  await this.syncToMarketplaces(product, inventory);
}
```

❌ **Bad**:
```typescript
syncProduct(productId: string): Promise<void> {
  return this.repository.findById(productId)
    .then(product => {
      return this.inventoryMaster.getInventory(productId)
        .then(inventory => {
          return this.syncToMarketplaces(product, inventory);
        });
    });
}
```

### Validation

**Validate input at the interface layer** using DTOs with `class-validator`:

```typescript
// interfaces/http/dto/create-product.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsNumber()
  @IsOptional()
  price?: number;
}

// interfaces/http/product.controller.ts
@Post()
async createProduct(@Body() dto: CreateProductDto): Promise<ProductResponse> {
  return this.productService.createProduct(dto);
}
```

### Type Safety

**Avoid `any` type**. Use `unknown` if type is truly unknown, then narrow it:

```typescript
function processData(data: unknown): void {
  if (typeof data === 'string') {
    // TypeScript knows data is string here
    console.log(data.toUpperCase());
  }
}
```

### Import Aliases

**Always import core symbols through the top-level barrel; use short relative paths for same-context cross-layer files.**

**Available aliases** (configured in `tsconfig.base.json`):
- `@openlinker/core/*` - Core library modules (top-level barrels only — see below)
- `@openlinker/shared/*` - Shared utilities
- `@openlinker/api/*` - API application modules

**The runtime constraint** (#591, #594): `libs/core/package.json` `exports` exposes only the top-level context barrels (`@openlinker/core/<ctx>`) plus two explicit sub-barrels — `@openlinker/core/listings/services` (Nest wiring, #337/#359) and `@openlinker/core/<ctx>/orm-entities` (host-only ORM-entity access, #594). Deep paths like `@openlinker/core/<ctx>/domain/...`, `.../application/...`, `.../infrastructure/...` are **not exported** — they fail at Node runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`. ESLint guards this in `libs/integrations/**` and `apps/{api,worker}/**`; the `orm-entities` sub-barrels carry an additional ban in `libs/integrations/**` and core port files so plugins never see TypeORM types.

**Rules**:

1. **Same-context cross-layer files** (importer and target both inside `libs/core/src/<ctx>/`): use a relative import IF the path fits ≤ `../..`. Most application/services or infrastructure/adapters reaching back to domain/ fall here (`../../domain/...`). The general ESLint override at `.eslintrc.js:192-202` permits this for `infrastructure/`, `persistence/`, and `application/` folders.

2. **Same-context but deeper than `../..`** (importer is in `<ctx>/<layer>/<deeper>/<dirs>/`): use the **top-level barrel alias** `@openlinker/core/<ctx>` instead. The deep-relative-imports ban (rule 5 below) wins over the cross-layer-relative rule.

3. **Cross-context imports** (different contexts inside `libs/core`, or across packages): use the top-level barrel alias `@openlinker/core/<ctx>`. Never reach into `/domain/`, `/application/`, or `/infrastructure/` sub-paths.

4. **Local/neighbor files** (same folder or one up): relative imports (`./`, `../`).

5. **External packages**: package names directly (`@nestjs/common`, `typeorm`).

6. **Ban deep relative imports**: Avoid `../../../` or deeper. If you'd need that, the import is cross-context — route it through the barrel.

✅ **Good**:
```typescript
// Local / neighbor — relative
import { IIdentifierMappingService } from './identifier-mapping.service.interface';
import { IdentifierMappingDto } from '../dto/identifier-mapping.dto';

// Same-context cross-layer (e.g., application/services → domain/ports), fits ≤ ../..
import { IdentifierMappingPort } from '../../domain/ports/identifier-mapping.port';

// Cross-context — barrel only
import { Connection } from '@openlinker/core/identifier-mapping';
import { Product, ProductMasterPort } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

// External packages
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
```

❌ **Bad**:
```typescript
// Don't reach into core internals — fails at Node runtime, banned by ESLint
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping/domain/ports/identifier-mapping.port';

// Don't use deep relative imports — same target is reachable via the barrel
import { IdentifierMappingPort } from '../../../domain/ports/identifier-mapping.port';

// Don't use relative imports for cross-package
import { Logger } from '../../../shared/logging';
```

**Why this approach**:
- **Top-level-barrel-only for cross-context**: deep paths leak internals; when a context refactors its layout (or a domain entity moves to a new bounded context), plugins/consumers don't break.
- **Short relative for same-context cross-layer**: avoids the `ERR_PACKAGE_PATH_NOT_EXPORTED` runtime trap and keeps intra-context refactors local.
- **Enforceable**: ESLint guards at `.eslintrc.js` (port files, integration packages, host apps) reject deep aliases at lint time; package.json `exports` reject them at Node runtime.

**Sub-barrels** are the narrow exception to "top-level-barrel-only". They exist to expose a host-only seam that would otherwise pollute the contract surface plugins consume. Two exist today:

- `@openlinker/core/listings/services` — the `ListingsModule` + the 7 `@Injectable` service classes. Kept off the main `@openlinker/core/listings` barrel to prevent runtime circular requires when sibling packages value-import the contract from the main barrel (#337/#359).
- `@openlinker/core/<ctx>/orm-entities` — TypeORM-decorated ORM entities for each context that has cross-context consumers (today: `products`, `inventory`, `orders`, `sync`, `identifier-mapping`, `integrations`, `content`). Kept off the main barrel because TypeORM entities are infrastructure detail; exposing them would couple plugins to TypeORM (#594). Consumed only by integration-test fixtures/helpers in `apps/{api,worker}/test/` and by core orchestration modules that need to register a sibling context's entity (today: `listings.module.ts`). The TypeORM CLI itself discovers entities via a filesystem glob in `apps/api/src/database/data-source.ts`, not through these sub-barrels.

Add a new `<ctx>/orm-entities` sub-barrel only when an external consumer needs a context's ORM entity — same-module registrations should keep using relative paths into `infrastructure/persistence/entities/`. Plugin packages (`libs/integrations/**`) and core port files are ESLint-blocked from importing any `orm-entities` sub-barrel.

**Import Order**:
1. External packages (NestJS, TypeORM, etc.)
2. Cross-boundary imports (using aliases)
3. Local imports (relative paths)

```typescript
// 1. External packages
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';

// 2. Cross-boundary imports (top-level barrels only — #591)
import { Logger } from '@openlinker/shared/logging';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

// 3. Local imports (relative)
import { IIdentifierMappingService } from './identifier-mapping.service.interface';
import { IdentifierMappingDto } from '../dto/identifier-mapping.dto';
```

**ESLint Recommendation**:
- Allow relative imports up to `../..`
- Require aliases for `../../../` or deeper
- Require aliases for cross-package imports

---

## Testing Standards

### Test Structure

**Unit Tests**: Test individual classes/methods in isolation
**Integration Tests**: Test interactions between components
**E2E Tests**: Test complete workflows

### Unit Test Example

```typescript
// product.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { InventoryMasterPort } from '../domain/ports/inventory-master.port';

describe('ProductService', () => {
  let service: ProductService;
  let inventoryMaster: jest.Mocked<InventoryMasterPort>;

  beforeEach(async () => {
    const mockInventoryMaster: jest.Mocked<InventoryMasterPort> = {
      getInventory: jest.fn(),
      adjustInventory: jest.fn(),
      // ... other methods
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        {
          provide: InventoryMasterPort,
          useValue: mockInventoryMaster,
        },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
    inventoryMaster = module.get(InventoryMasterPort);
  });

  describe('syncProduct', () => {
    it('should sync product inventory', async () => {
      // Arrange
      const productId = 'product-123';
      const inventory = { productId, quantity: 10, reserved: 2 };
      inventoryMaster.getInventory.mockResolvedValue(inventory);

      // Act
      await service.syncProduct(productId);

      // Assert
      expect(inventoryMaster.getInventory).toHaveBeenCalledWith(productId);
    });
  });
});
```

### Mocking Ports

**Always mock ports, not concrete adapters**:

✅ **Good**:
```typescript
const mockInventoryMaster: jest.Mocked<InventoryMasterPort> = {
  getInventory: jest.fn(),
  adjustInventory: jest.fn(),
};
```

❌ **Bad**:
```typescript
const mockPrestashopAdapter = new PrestashopAdapter(); // Don't use real adapter
```

### Test Coverage

**Minimum coverage requirements**:
- **Core domain logic**: 90%+
- **Application services**: 80%+
- **Infrastructure adapters**: 70%+
- **Controllers**: 70%+

### Test Naming

**Use descriptive test names**:

```typescript
describe('ProductService', () => {
  describe('syncProduct', () => {
    it('should sync product when inventory is available', async () => {
      // ...
    });

    it('should throw error when product not found', async () => {
      // ...
    });

    it('should handle inventory master failure gracefully', async () => {
      // ...
    });
  });
});
```

---

## Git Workflow

### Branch Naming

- **Feature**: `feature/{short-description}` (e.g., `feature/add-shopify-integration`)
- **Bugfix**: `bugfix/{short-description}` (e.g., `bugfix/fix-inventory-sync`)
- **Hotfix**: `hotfix/{short-description}` (e.g., `hotfix/fix-auth-bug`)
- **Chore**: `chore/{short-description}` (e.g., `chore/update-dependencies`)
- **Docs**: `docs/{short-description}` (e.g., `docs/add-api-documentation`)

### Commit Messages

**Use Conventional Commits** format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(inventory): add inventory sync service

Implement InventorySyncService that synchronizes inventory from
InventoryMasterPort to marketplace adapters.

Closes #123
```

```
fix(orders): handle null order status gracefully

Add null check in OrderSyncService to prevent crashes when order
status is null.

Fixes #456
```

### Pull Requests

**PR Title**: Use conventional commit format
**PR Description**: Include:
- What changed and why
- How to test
- Related issues
- Screenshots (if UI changes)

---

## Code Review Guidelines

### Review Checklist

- [ ] Code follows naming conventions
- [ ] Code uses ports/interfaces, not concrete implementations
- [ ] Domain layer has no framework dependencies
- [ ] Error handling is appropriate
- [ ] Tests are included and passing
- [ ] Logging is appropriate
- [ ] Documentation is updated (if needed)
- [ ] No `any` types (unless justified)
- [ ] Async/await used correctly
- [ ] Input validation present

### Review Focus Areas

1. **Architecture Compliance**: Does it follow hexagonal architecture?
2. **Dependency Direction**: Are dependencies pointing in the right direction?
3. **Testability**: Can it be easily tested?
4. **Error Handling**: Are errors handled appropriately?
5. **Performance**: Are there any performance concerns?

---

## ESLint & Prettier Configuration

### ESLint Config

```json
{
  "extends": [
    "@nestjs/eslint-config-nestjs",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  }
}
```

### Prettier Config

```json
{
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "semi": true,
  "printWidth": 100,
  "arrowParens": "always"
}
```

---
## Testing

OpenLinker uses a comprehensive testing approach with unit tests and integration tests. For detailed information about testing, including Testcontainers, see the [Testing Guide](./testing-guide.md).

### Quick Test Commands

```bash
# Run unit tests (fast, no Docker required)
pnpm test

# Run integration tests (requires Docker, uses Testcontainers)
pnpm test:integration

# Run both test suites
pnpm test && pnpm test:integration
```

### Testcontainers vs Development Stack

**Important**: Integration tests use **Testcontainers** to spin up **ephemeral** PostgreSQL and Redis containers. These are **separate** from the development stack containers managed by `docker-compose.yml`:

| Purpose | Technology | Containers | Lifecycle |
|---------|------------|------------|-----------|
| **Development Stack** | Docker Compose | `postgres`, `redis`, `mysql`, `prestashop` | Persistent (survive restarts) |
| **Integration Tests** | Testcontainers | Ephemeral PostgreSQL + Redis | Auto-created/destroyed per test run |

**Why Separate?**
- ✅ **Isolation**: Tests don't interfere with development data
- ✅ **Clean State**: Each test run starts with a fresh database
- ✅ **No Conflicts**: Tests can run while dev stack is running
- ✅ **CI/CD Ready**: Works identically in local and CI environments

See [Testing Guide](./testing-guide.md) for detailed explanation of Testcontainers and test organization.

## Next Steps

After setting up the development environment:

1. **Configure PrestaShop Webservice API** (see PrestaShop Setup above)
2. **Review Architecture**: Read [Architecture Overview](./architecture-overview.md)
3. **Start Development**: Begin implementing adapters or features
4. **Run Tests**: See [Testing Guide](./testing-guide.md) for comprehensive testing documentation

## Related Documentation
- [Testing Guide](./testing-guide.md) - **Comprehensive testing documentation** (unit tests, integration tests, Testcontainers)
- [Architecture Overview](./architecture-overview.md) - System architecture
- [AI Assistant Guide](./ai-assistant-guide.md) - Guide for AI coding assistants
- [Database Migrations](./migrations.md) - Database migration workflow and best practices

