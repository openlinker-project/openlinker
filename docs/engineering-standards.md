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
- **Adapter Interfaces**: `*-adapter.interface.ts` (e.g., `prestashop-inventory-master.adapter.interface.ts`) - interface definition only (if needed)
- **Adapters**: `*-adapter.ts` (e.g., `prestashop-inventory-master.adapter.ts`) - implements port interface
- **Mappers**: `*.mapper.ts` (e.g., `product.mapper.ts`)
- **Types**: `*.types.ts` (e.g., `adapter.types.ts`) - type definitions only

#### Interface Layer Files

- **Controllers**: `*.controller.ts` (e.g., `product.controller.ts`)
- **Request DTOs**: `create-*.dto.ts`, `update-*.dto.ts` (e.g., `create-product.dto.ts`)
- **Response DTOs**: `*-response.dto.ts` (e.g., `product-response.dto.ts`)
- **Event Handlers**: `*-event.handler.ts` (e.g., `product-event.handler.ts`)

#### Test Files

- **Unit Tests**: `*.spec.ts` (e.g., `product.service.spec.ts`)
- **Integration Tests**: `*.integration.spec.ts` (e.g., `product.integration.spec.ts`)
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
  - `AllegroMarketplaceAdapter`

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
export type ProductSyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';

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

```typescript
// domain/exceptions/product-not-found.exception.ts
export class ProductNotFoundException extends Error {
  constructor(productId: string) {
    super(`Product not found: ${productId}`);
    this.name = 'ProductNotFoundException';
  }
}

// Usage
if (!product) {
  throw new ProductNotFoundException(productId);
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

**Use NestJS Logger wrapper** from shared library:

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
      this.logger.error(`Failed to sync product: ${productId}`, error.stack);
      throw error;
    }
  }
}
```

**Log levels**:
- `log()`: General information
- `debug()`: Detailed debugging information
- `warn()`: Warnings
- `error()`: Errors with stack traces

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

## Related Documentation

- [Architecture Overview](./architecture-overview.md) - System architecture
- [AI Assistant Guide](./ai-assistant-guide.md) - Guide for AI coding assistants

