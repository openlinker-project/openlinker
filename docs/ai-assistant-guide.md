# AI Assistant Guide

This guide is designed to help AI coding assistants (ChatGPT, GitHub Copilot, Cursor, etc.) understand the OpenLinker architecture and generate code that follows our standards.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Principles](#core-principles)
3. [Capability Roles (Ports)](#capability-roles-ports)
4. [Project Structure](#project-structure)
5. [Code Generation Rules](#code-generation-rules)
6. [Example Prompts](#example-prompts)
7. [Common Patterns](#common-patterns)

---

## Architecture Overview

OpenLinker is an **e-commerce integration platform** built with **NestJS** and **Hexagonal Architecture**. The system synchronizes data (products, inventory, orders) between multiple e-commerce platforms (PrestaShop, Allegro, Shopify, etc.).

### Key Concepts

1. **Hexagonal Architecture**: Business logic is isolated from external systems
2. **Ports & Adapters**: Core domain depends on interfaces (ports), not concrete implementations
3. **Capability Abstractions**: Business roles (like `InventoryMaster`, `OrderProcessorManager`) abstract away specific systems
4. **Monorepo**: Single repository with multiple packages (`apps/`, `libs/`)

### Architecture Layers

```
Interfaces (HTTP/Events) → Application (Use Cases) → Domain (Business Logic)
                                                           ↑
Infrastructure (Adapters, Repositories) ───────────────────┘
```

**Rule**: Dependencies flow inward. Domain has NO dependencies on NestJS, TypeORM, or any framework.

---

## Core Principles

### 1. Always Code Against Ports, Never Concrete Implementations

**❌ WRONG**:
```typescript
@Injectable()
export class InventoryService {
  constructor(
    private prestashopAdapter: PrestashopAdapter, // ❌ Concrete implementation
  ) {}
}
```

**✅ CORRECT**:
```typescript
@Injectable()
export class InventoryService {
  constructor(
    private inventoryMaster: InventoryMasterPort, // ✅ Port interface
  ) {}
}
```

### 2. Domain Layer Must Be Framework-Free

**❌ WRONG**:
```typescript
// domain/entities/product.entity.ts
import { Entity, Column } from 'typeorm'; // ❌ Framework dependency

@Entity()
export class Product {
  @Column()
  id: string;
}
```

**✅ CORRECT**:
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

### 3. Use Dependency Injection, Not Static Calls

**❌ WRONG**:
```typescript
export class ProductService {
  async getProduct(id: string) {
    const adapter = new PrestashopAdapter(); // ❌ Direct instantiation
    return adapter.getProduct(id);
  }
}
```

**✅ CORRECT**:
```typescript
@Injectable()
export class ProductService {
  constructor(
    private readonly productRepository: ProductRepository, // ✅ Injected
  ) {}

  async getProduct(id: string) {
    return this.productRepository.findById(id);
  }
}
```

### 4. Capability Roles Are Business Abstractions

We don't code against "PrestaShop" or "Allegro". We code against **business capabilities**:

- `ProductMasterPort`: Single source of truth for product catalog
- `InventoryMasterPort`: Single source of truth for inventory
- `OrderProcessorManagerPort`: Orchestrates order lifecycle
- `PricingAuthorityPort`: Manages pricing (future)

**Example**: Even if PrestaShop is currently the `ProductMaster`, we code against `ProductMasterPort`, not `PrestashopAdapter`.

---

## Capability Roles (Ports)

### ProductMasterPort

**Purpose**: Manages product catalog. Acts as the single source of truth for products, variants, and categories.

**When to use**: Whenever you need to read, create, update, or delete products.

**Example**:
```typescript
interface ProductMasterPort {
  getProduct(productId: string): Promise<Product>;
  getProducts(filters?: ProductFilters): Promise<Product[]>;
  createProduct(product: ProductCreate): Promise<Product>;
  updateProduct(productId: string, product: ProductUpdate): Promise<Product>;
  deleteProduct(productId: string): Promise<void>;
  getProductVariants(productId: string): Promise<ProductVariant[]>;
  upsertProductVariant(productId: string, variant: ProductVariantCreate): Promise<ProductVariant>;
  getProductCategories(productId: string): Promise<Category[]>;
  assignCategories(productId: string, categoryIds: string[]): Promise<void>;
  searchProducts(query: string, filters?: ProductFilters): Promise<Product[]>;
}
```

**Usage**:
```typescript
@Injectable()
export class ProductSyncService {
  constructor(
    private readonly productMaster: ProductMasterPort, // ✅ Port
  ) {}

  async syncProductToMarketplace(productId: string, marketplaceId: string) {
    const product = await this.productMaster.getProduct(productId);
    // Sync to marketplace...
  }
}
```

### InventoryMasterPort

**Purpose**: Manages inventory/stock levels. Acts as the single source of truth.

**When to use**: Whenever you need to read or modify inventory.

**Example**:
```typescript
interface InventoryMasterPort {
  getInventory(productId: string, locationId?: string): Promise<Inventory>;
  adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory>;
  reserveInventory(productId: string, quantity: number, orderId: string): Promise<void>;
  releaseInventory(productId: string, quantity: number, orderId: string): Promise<void>;
  getAvailableQuantity(productId: string, locationId?: string): Promise<number>;
}
```

**Usage**:
```typescript
@Injectable()
export class InventorySyncService {
  constructor(
    private readonly inventoryMaster: InventoryMasterPort, // ✅ Port
  ) {}

  async syncInventory(productId: string) {
    const inventory = await this.inventoryMaster.getInventory(productId);
    // Sync to marketplaces...
  }
}
```

### OrderProcessorManagerPort

**Purpose**: Orchestrates order lifecycle (creation, status updates, cancellations).

**When to use**: When creating orders, updating order status, or processing order events.

**Example**:
```typescript
interface OrderProcessorManagerPort {
  createOrder(order: OrderCreate): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order>;
  cancelOrder(orderId: string, reason?: string): Promise<Order>;
  processReturn(orderId: string, returnData: ReturnData): Promise<Order>;
  getOrders(filters: OrderFilters): Promise<Order[]>;
}
```

**Usage**:
```typescript
@Injectable()
export class OrderSyncService {
  constructor(
    private readonly orderProcessor: OrderProcessorManagerPort, // ✅ Port
  ) {}

  async syncOrderFromMarketplace(order: Order) {
    const createdOrder = await this.orderProcessor.createOrder(order);
    // ...
  }
}
```

---

## Project Structure

### Standard Module Layout

```
libs/core/src/{domain}/
├── domain/                    # Pure business logic (NO framework code)
│   ├── entities/             # Domain entities
│   ├── value-objects/        # Value objects
│   ├── domain-services/     # Domain services
│   ├── domain-events/        # Domain events
│   └── ports/               # Port interfaces (ProductMasterPort, InventoryMasterPort, etc.)
│
├── application/              # Use cases and orchestration
│   ├── use-cases/           # Use case implementations
│   ├── services/            # Application services
│   └── dto/                 # Application DTOs
│
├── infrastructure/          # External adapters and persistence
│   ├── persistence/         # Database (TypeORM entities, repositories)
│   ├── adapters/            # External API adapters
│   └── mappers/             # Data mappers
│
└── interfaces/              # HTTP controllers, event handlers
    ├── http/               # REST controllers
    ├── events/             # Event handlers
    └── dto/                # Request/Response DTOs
```

### File Naming Conventions

- **Ports**: `*.port.ts` (e.g., `inventory-master.port.ts`)
- **Adapters**: `*-adapter.ts` (e.g., `prestashop-inventory-master.adapter.ts`)
- **Entities**: `*.entity.ts` (e.g., `product.entity.ts`)
- **Services**: `*.service.ts` (e.g., `product-sync.service.ts`)
- **Controllers**: `*.controller.ts` (e.g., `product.controller.ts`)
- **DTOs**: `*.dto.ts` (e.g., `create-product.dto.ts`)
- **Tests**: `*.spec.ts` (e.g., `product.service.spec.ts`)

---

## Code Generation Rules

When generating code, follow these rules:

### 1. Always Use Dependency Injection

```typescript
@Injectable()
export class MyService {
  constructor(
    private readonly dependency: DependencyPort, // ✅ Inject dependencies
  ) {}
}
```

### 2. Never Import NestJS Decorators into Domain Layer

```typescript
// ❌ WRONG: domain/entities/product.entity.ts
import { Entity, Column } from 'typeorm';

// ✅ CORRECT: domain/entities/product.entity.ts
export class Product {
  constructor(
    public readonly id: string,
    public readonly name: string,
  ) {}
}
```

### 3. Always Code Against Ports

```typescript
// ✅ CORRECT
constructor(
  private readonly inventoryMaster: InventoryMasterPort,
) {}

// ❌ WRONG
constructor(
  private readonly prestashopAdapter: PrestashopAdapter,
) {}
```

### 4. Use TypeScript Strict Mode

- No `any` types (use `unknown` if needed)
- Explicit return types for public methods
- Proper null handling

### 5. Use Async/Await, Not Promises

```typescript
// ✅ CORRECT
async getProduct(id: string): Promise<Product> {
  const product = await this.repository.findById(id);
  return product;
}

// ❌ WRONG
getProduct(id: string): Promise<Product> {
  return this.repository.findById(id).then(product => product);
}
```

### 6. Handle Errors Appropriately

```typescript
async getProduct(id: string): Promise<Product> {
  try {
    const product = await this.repository.findById(id);
    if (!product) {
      throw new ProductNotFoundException(id);
    }
    return product;
  } catch (error) {
    if (error instanceof ProductNotFoundException) {
      throw error; // Re-throw domain exceptions
    }
    this.logger.error('Failed to get product', error);
    throw new InternalServerErrorException('Failed to retrieve product');
  }
}
```

### 7. Validate Input at Interface Layer

```typescript
// interfaces/http/dto/create-product.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

// interfaces/http/product.controller.ts
@Post()
async createProduct(@Body() dto: CreateProductDto): Promise<ProductResponse> {
  return this.productService.createProduct(dto);
}
```

---

## Example Prompts

### Example 1: Generate Inventory Sync Service

**Prompt**:
```
Generate a NestJS service called InventorySyncService that:
1. Uses InventoryMasterPort to get inventory for a product
2. Finds all product mappings for that product
3. Updates offer quantities on all configured marketplace adapters
4. Follows hexagonal architecture (no direct PrestaShop calls)
5. Includes proper error handling and logging
6. Uses async/await
```

**Expected Output**:
```typescript
@Injectable()
export class InventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);

  constructor(
    private readonly inventoryMaster: InventoryMasterPort,
    private readonly productMappingService: ProductMappingService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  async syncInventory(productId: string): Promise<void> {
    this.logger.log(`Syncing inventory for product: ${productId}`);

    try {
      // Get inventory from master
      const inventory = await this.inventoryMaster.getInventory(productId);
      const availableQuantity = inventory.quantity - inventory.reserved;

      // Find product mappings
      const mappings = await this.productMappingService.getMappingsByProduct(
        productId,
      );

      // Update each marketplace
      for (const mapping of mappings) {
        const marketplaceAdapter = await this.integrationsService.getAdapter(
          mapping.marketplacePlatformId,
          'IMarketplaceIntegration',
        );

        await marketplaceAdapter.updateOfferQuantity(
          mapping.marketplaceOfferId,
          availableQuantity,
        );

        this.logger.log(
          `Updated offer ${mapping.marketplaceOfferId} on ${mapping.marketplacePlatformId}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to sync inventory for product: ${productId}`, error.stack);
      throw error;
    }
  }
}
```

### Example 2: Generate Order Sync Listener

**Prompt**:
```
Generate a NestJS event listener that:
1. Listens for 'allegro.order.received' events
2. Uses OrderProcessorManagerPort to create orders (not PrestaShop directly)
3. Maps products using ProductMappingService
4. Maps order status using StatusMappingService
5. Saves order mapping
6. Includes error handling
```

**Expected Output**:
```typescript
@Injectable()
export class OrderSyncListener {
  private readonly logger = new Logger(OrderSyncListener.name);

  constructor(
    private readonly orderProcessor: OrderProcessorManagerPort,
    private readonly productMappingService: ProductMappingService,
    private readonly statusMappingService: StatusMappingService,
    private readonly orderMappingRepository: Repository<OrderMapping>,
  ) {}

  @OnEvent('allegro.order.received')
  async handleAllegroOrderReceived(payload: { order: Order }): Promise<void> {
    const { order } = payload;

    this.logger.log(`Processing Allegro order: ${order.id}`);

    try {
      // Map products
      const mappedItems = await Promise.all(
        order.items.map(async (item) => {
          const mapping = await this.productMappingService.getMapping(
            'allegro',
            item.productId,
          );
          return {
            ...item,
            productId: mapping.shopProductId,
          };
        }),
      );

      // Map status
      const shopStatus = await this.statusMappingService.mapStatus(
        'allegro',
        'prestashop',
        order.status,
      );

      // Create order using port
      const orderCreate: OrderCreate = {
        ...order,
        items: mappedItems,
        status: shopStatus,
      };

      const createdOrder = await this.orderProcessor.createOrder(orderCreate);

      // Save mapping
      await this.orderMappingRepository.save({
        marketplaceOrderId: order.id,
        marketplacePlatformId: 'allegro',
        shopOrderId: createdOrder.id,
        shopPlatformId: 'prestashop',
      });

      this.logger.log(`Order synced successfully: ${createdOrder.id}`);
    } catch (error) {
      this.logger.error(`Failed to sync order: ${order.id}`, error.stack);
      throw error;
    }
  }
}
```

### Example 3: Generate PrestaShop Inventory Master Adapter

**Prompt**:
```
Generate a PrestashopInventoryMasterAdapter that:
1. Implements InventoryMasterPort interface
2. Communicates with PrestaShop API using HTTP client
3. Maps PrestaShop data to unified Inventory schema
4. Handles authentication (API key)
5. Includes error handling
6. Is a NestJS injectable service
```

**Expected Output**:
```typescript
@Injectable()
export class PrestashopInventoryMasterAdapter implements InventoryMasterPort {
  private readonly logger = new Logger(PrestashopInventoryMasterAdapter.name);
  private credentials: PrestaShopCredentials | null = null;

  constructor(private readonly httpService: HttpService) {}

  async initialize(credentials: PrestaShopCredentials): Promise<void> {
    this.credentials = credentials;
    // Test connection
    await this.testConnection();
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${this.credentials.baseUrl}/api/products`,
        {
          headers: {
            'Authorization': `Basic ${this.credentials.apiKey}`,
          },
        },
      );
      return response.status === 200;
    } catch (error) {
      this.logger.error('PrestaShop connection test failed', error);
      return false;
    }
  }

  async getInventory(productId: string, locationId?: string): Promise<Inventory> {
    if (!this.credentials) {
      throw new Error('Adapter not initialized');
    }

    try {
      const response = await this.httpService.axiosRef.get(
        `${this.credentials.baseUrl}/api/stock_availables/${productId}`,
        {
          headers: {
            'Authorization': `Basic ${this.credentials.apiKey}`,
          },
        },
      );

      const prestashopInventory = response.data;
      
      // Map to unified schema
      return {
        productId,
        locationId: locationId || 'default',
        quantity: prestashopInventory.quantity,
        reserved: prestashopInventory.reserved_quantity || 0,
      };
    } catch (error) {
      this.logger.error(`Failed to get inventory for product: ${productId}`, error);
      throw new Error(`Failed to get inventory from PrestaShop: ${error.message}`);
    }
  }

  async adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory> {
    // Implementation...
  }

  async reserveInventory(productId: string, quantity: number, orderId: string): Promise<void> {
    // Implementation...
  }

  async releaseInventory(productId: string, quantity: number, orderId: string): Promise<void> {
    // Implementation...
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    const inventory = await this.getInventory(productId, locationId);
    return inventory.quantity - inventory.reserved;
  }
}
```

---

## Common Patterns

### Pattern 1: Getting Capability Adapter

```typescript
// Get adapter assigned to a capability role
const inventoryMaster = await this.integrationsService.getCapabilityAdapter<InventoryMasterPort>(
  'InventoryMaster',
);
```

### Pattern 2: Service Using Port

```typescript
@Injectable()
export class MyService {
  constructor(
    private readonly capabilityPort: CapabilityPort, // ✅ Port interface
  ) {}

  async doSomething() {
    const result = await this.capabilityPort.someMethod();
    // ...
  }
}
```

### Pattern 3: NestJS Module with Port Provider

```typescript
@Module({
  providers: [
    PrestashopInventoryMasterAdapter,
    {
      provide: InventoryMasterPort,
      useClass: PrestashopInventoryMasterAdapter,
    },
  ],
  exports: [InventoryMasterPort],
})
export class PrestashopModule {}
```

### Pattern 4: Domain Entity (No Framework)

```typescript
// domain/entities/product.entity.ts
export class Product {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly sku: string,
    public readonly price: Money,
  ) {}

  updatePrice(newPrice: Money): Product {
    return new Product(this.id, this.name, this.sku, newPrice);
  }
}
```

---

## Quick Reference

### ✅ DO

- Code against ports (`ProductMasterPort`, `InventoryMasterPort`, `OrderProcessorManagerPort`)
- Use dependency injection
- Keep domain layer framework-free
- Use async/await
- Handle errors appropriately
- Validate input at interface layer
- Use TypeScript strict mode

### ❌ DON'T

- Code against concrete adapters (`PrestashopAdapter`)
- Import framework code into domain layer
- Use direct instantiation instead of DI
- Use `any` type
- Skip error handling
- Skip input validation
- Mix concerns (domain + infrastructure)

---

## Related Documentation

- [Architecture Overview](./architecture-overview.md) - Detailed architecture documentation
- [Engineering Standards](./engineering-standards.md) - Coding standards and conventions

