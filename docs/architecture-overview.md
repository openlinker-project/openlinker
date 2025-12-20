# Architecture Overview

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Core Bounded Contexts](#core-bounded-contexts)
3. [Capability Abstractions (Business Roles)](#capability-abstractions-business-roles)
4. [Hexagonal Architecture Structure](#hexagonal-architecture-structure)
5. [Module Organization](#module-organization)
6. [Data Flow](#data-flow)
7. [Technology Stack](#technology-stack)

---

## High-Level Architecture

OpenLinker follows a **Hexagonal Architecture** (Ports and Adapters) pattern, organized as a modular monorepo. The system is designed to be:

- **Modular**: Clear separation between core domain and integrations
- **Extensible**: Easy to add new platforms without modifying core logic
- **Testable**: Domain logic isolated from infrastructure concerns
- **Maintainable**: Business capabilities abstracted from concrete implementations

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend/UI                             │
│                    (Separate Application)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP REST API (JWT)
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    Core API (OpenLinker)                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Interfaces Layer (HTTP/REST)                │   │
│  │  - Controllers (REST endpoints)                          │   │
│  │  - Request/Response DTOs                                 │   │
│  │  - Authentication & Authorization                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Application Layer (Use Cases)                  │   │
│  │  - ProductSyncService                                    │   │
│  │  - InventorySyncService                                  │   │
│  │  - OrderSyncService                                      │   │
│  │  - OfferSyncService                                      │   │
│  │  - MappingServices                                       │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │    Infrastructure Services                         │  │   │
│  │  │  - IdentifierMappingService                         │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Domain Layer (Business Logic)               │   │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │   │   Products   │  │  Inventory   │  │    Orders    │   │   │
│  │   │   Domain     │  │    Domain    │  │    Domain    │   │   │
│  │   └──────────────┘  └──────────────┘  └──────────────┘   │   │
│  │                                                          │   │
│  │   ┌──────────────┐                                       │   │
│  │   │   Listings  │                                       │   │
│  │   │   Domain    │                                       │   │
│  │   └──────────────┘                                       │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │         Capability Ports (Interfaces)              │  │   │
│  │  │  - ProductMasterPort                               │  │   │
│  │  │  - InventoryMasterPort                             │  │   │
│  │  │  - OrderProcessorManagerPort                       │  │   │
│  │  │  - PricingAuthorityPort (future)                   │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │          Infrastructure Layer (Adapters)                 │   │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │   │  PrestaShop  │  │   Allegro    │  │   InPost     │   │   │
│  │   │   Adapters   │  │   Adapters   │  │   Adapters   │   │   │
│  │   └──────────────┘  └──────────────┘  └──────────────┘   │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │    Adapters Implementing Capability Ports          │  │   │
│  │  │  - PrestashopProductMasterAdapter                  │  │   │
│  │  │  - PrestashopInventoryMasterAdapter                │  │   │
│  │  │  - PrestashopOrderProcessorAdapter                 │  │   │
│  │  │  - AllegroMarketplaceAdapter                       │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │          Infrastructure Layer (Persistence)              │   │
│  │  - PostgreSQL (TypeORM)                                  │   │
│  │  - Redis (Caching, Event Bus)                            │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP/API Calls
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼──────┐    ┌────────▼────────┐    ┌─────▼──────────┐
│  PrestaShop  │    │     Allegro     │    │  Other         │
│     API      │    │       API       │    │  Platforms     │
└──────────────┘    └─────────────────┘    └────────────────┘
```

---

## Core Bounded Contexts

The system is organized into the following core bounded contexts:

### 1. Identity
- **Responsibility**: User authentication, authorization
- **Key Entities**: User, Role, Permission
- **Location**: `apps/api/src/auth/` or `libs/core/src/auth/`

### 2. Products
- **Responsibility**: Product catalog management, product mapping between platforms
- **Key Entities**: Product, ProductMapping, ProductVariant
- **Location**: `libs/core/src/products/`
- **Capability**: Uses `ProductMasterPort` abstraction

### 3. Inventory
- **Responsibility**: Inventory synchronization, stock level management
- **Key Entities**: Inventory, InventoryAdjustment, InventoryMapping
- **Location**: `libs/core/src/inventory/`
- **Capability**: Uses `InventoryMasterPort` abstraction

### 4. Orders
- **Responsibility**: Order synchronization, order lifecycle management
- **Key Entities**: Order, OrderMapping, OrderStatus
- **Location**: `libs/core/src/orders/`
- **Capability**: Uses `OrderProcessorManagerPort` abstraction

### 5. Listings (Offers)
- **Responsibility**: Marketplace offer/listing management, offer lifecycle, offer-to-product mapping
- **Key Entities**: Offer, Listing, OfferMapping, OfferStatus
- **Location**: `libs/core/src/listings/`
- **Capability**: Uses `IMarketplaceIntegration` abstraction for offer operations
- **Key Features**:
  - Creating and updating offers on marketplaces
  - Managing offer quantities based on inventory
  - Offer-to-product mapping
  - Offer status synchronization
  - Price management for marketplace offers

### 6. Sync Manager
- **Responsibility**: Job scheduling, retry logic, sync orchestration
- **Key Services**: SyncJobService, RetryService, SchedulerService
- **Location**: `libs/core/src/sync/` or `apps/api/src/sync/`

### 7. Event Bus / Messaging
- **Responsibility**: Event-driven communication between modules
- **Technology**: Redis Streams (initial), RabbitMQ/Kafka (future)
- **Location**: `libs/core/src/events/`

### 8. Identifier Mapping Service
- **Responsibility**: Centralized identifier mapping between external platform IDs and internal OpenLinker IDs
- **Key Services**: IdentifierMappingService
- **Location**: `libs/core/src/identifier-mapping/`
- **Key Features**:
  - Generates unique internal identifiers for all entities (single seed across entire system)
  - Maps external platform identifiers to internal OpenLinker identifiers
  - Context-aware mapping (entity type, platform, etc.)
  - Used by adapters to replace external IDs with internal IDs during data transformation
- **Architecture**: Core infrastructure service used by all adapters

### 9. Plugin Manager / Integrations
- **Responsibility**: Adapter registry, capability assignment, plugin lifecycle
- **Key Services**: IntegrationsService, PluginRegistryService
- **Location**: `apps/api/src/integrations/` or `libs/core/src/integrations/`

### 10. Logging & Monitoring
- **Responsibility**: Structured logging, metrics, tracing
- **Technology**: NestJS Logger, OpenTelemetry (future)
- **Location**: `libs/shared/src/logging/`

---

## Capability Abstractions (Business Roles)

Instead of coding directly against specific systems (e.g., PrestaShop, Allegro), the core domain depends on **business capability abstractions** (ports). This allows:

- **Flexibility**: Switch implementations without changing core logic
- **Testability**: Easy to mock for testing
- **Clarity**: Business intent is explicit in code

### InventoryMasterPort

**Purpose**: Single source of truth for inventory/stock levels.

**Interface**:
```typescript
interface InventoryMasterPort {
  /**
   * Get current inventory for a product
   */
  getInventory(productId: string, locationId?: string): Promise<Inventory>;
  
  /**
   * Adjust inventory (increase or decrease)
   */
  adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory>;
  
  /**
   * Reserve inventory for an order
   */
  reserveInventory(productId: string, quantity: number, orderId: string): Promise<void>;
  
  /**
   * Release reserved inventory
   */
  releaseInventory(productId: string, quantity: number, orderId: string): Promise<void>;
  
  /**
   * Get available quantity (total - reserved)
   */
  getAvailableQuantity(productId: string, locationId?: string): Promise<number>;
}
```

**Current Implementation**: `PrestashopInventoryMasterAdapter` (MVP stage)

**Future Implementations**:
- `OpenLinkerInventoryMasterAdapter` (OpenLinker's own inventory system)
- `ShopifyInventoryMasterAdapter`
- `WooCommerceInventoryMasterAdapter`

### ProductMasterPort

**Purpose**: Single source of truth for product catalog. Manages product data, variants, attributes, and categories.

**Interface**:
```typescript
interface ProductMasterPort {
  /**
   * Get product by ID
   */
  getProduct(productId: string): Promise<Product>;
  
  /**
   * Get products with filters
   */
  getProducts(filters?: ProductFilters): Promise<Product[]>;
  
  /**
   * Create a new product
   */
  createProduct(product: ProductCreate): Promise<Product>;
  
  /**
   * Update an existing product
   */
  updateProduct(productId: string, product: ProductUpdate): Promise<Product>;
  
  /**
   * Delete a product
   */
  deleteProduct(productId: string): Promise<void>;
  
  /**
   * Get product variants
   */
  getProductVariants(productId: string): Promise<ProductVariant[]>;
  
  /**
   * Create or update product variant
   */
  upsertProductVariant(productId: string, variant: ProductVariantCreate): Promise<ProductVariant>;
  
  /**
   * Get product categories
   */
  getProductCategories(productId: string): Promise<Category[]>;
  
  /**
   * Assign product to categories
   */
  assignCategories(productId: string, categoryIds: string[]): Promise<void>;
  
  /**
   * Search products by query
   */
  searchProducts(query: string, filters?: ProductFilters): Promise<Product[]>;
}
```

**Current Implementation**: `PrestashopProductMasterAdapter` (MVP stage)

**Future Implementations**:
- `OpenLinkerProductMasterAdapter` (OpenLinker's own product catalog system)
- `ShopifyProductMasterAdapter`
- `WooCommerceProductMasterAdapter`

**Usage Example**:
```typescript
@Injectable()
export class ProductSyncService {
  constructor(
    private readonly productMaster: ProductMasterPort, // ✅ Port interface
  ) {}

  async syncProductToMarketplace(productId: string, marketplaceId: string) {
    // Get product from master
    const product = await this.productMaster.getProduct(productId);
    
    // Map to marketplace format and publish
    // ...
  }
}
```

### OrderProcessorManagerPort

**Purpose**: Orchestrates order lifecycle (creation, status changes, cancellations, returns).

**Interface**:
```typescript
interface OrderProcessorManagerPort {
  /**
   * Create a new order
   */
  createOrder(order: OrderCreate): Promise<Order>;
  
  /**
   * Get order by ID
   */
  getOrder(orderId: string): Promise<Order>;
  
  /**
   * Update order status
   */
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order>;
  
  /**
   * Cancel an order
   */
  cancelOrder(orderId: string, reason?: string): Promise<Order>;
  
  /**
   * Process return/refund
   */
  processReturn(orderId: string, returnData: ReturnData): Promise<Order>;
  
  /**
   * Get orders with filters
   */
  getOrders(filters: OrderFilters): Promise<Order[]>;
}
```

**Current Implementation**: `PrestashopOrderProcessorAdapter` (MVP stage)

**Future Implementations**:
- `OpenLinkerOrderProcessorAdapter` (OpenLinker's own order system)
- `ShopifyOrderProcessorAdapter`

### Future Capability Ports

- **PricingAuthorityPort**: Manages pricing rules and catalog pricing
- **ShippingProviderManagerPort**: Orchestrates shipping and tracking
- **PaymentProcessorPort**: Handles payment processing

---

## Identifier Mapping Service

### Overview

The **IdentifierMappingService** is a core infrastructure service responsible for managing the mapping between external platform identifiers (e.g., PrestaShop product ID, Allegro order ID) and internal OpenLinker identifiers. It ensures that all entities in the system have unique internal identifiers from a single unified seed, regardless of their origin platform.

### Key Responsibilities

1. **Generate Internal Identifiers**: Creates new unique internal IDs for entities when they are first encountered from external platforms
2. **Map External to Internal**: Provides mapping from external platform IDs to internal OpenLinker IDs
3. **Context-Aware Mapping**: Handles mapping based on entity type (Product, Order, Offer, etc.), platform, and context
4. **Maintain Mapping Registry**: Stores and retrieves mappings between external and internal identifiers

### Connection Entity

The system supports **multiple integrations of the same platform** (e.g., two PrestaShop stores). Each integration is represented by a `Connection` entity:

```typescript
interface Connection {
  id: string;                    // Unique connection ID
  platformType: string;          // 'prestashop', 'allegro', etc.
  name: string;                  // Human-readable name
  status: 'active' | 'disabled' | 'error';
  config: Record<string, any>;   // Connection-specific configuration
  credentialsRef: string;        // Reference to credentials storage
  createdAt: Date;
  updatedAt: Date;
}
```

**Why connections?**
- Support multiple instances of the same platform (e.g., multiple PrestaShop stores)
- Each connection has its own configuration and credentials
- Mappings are connection-scoped, not platform-scoped

### Interface

```typescript
interface IdentifierMappingService {
  /**
   * Get or create internal identifier for an external entity
   * If mapping exists, returns existing internal ID
   * If not, generates new internal ID and creates mapping
   */
  getOrCreateInternalId(
    entityType: 'Product' | 'Order' | 'Offer' | 'Inventory' | 'Customer' | string,
    externalId: string,
    connectionId: string,  // ✅ Connection ID (not platform ID)
    context?: MappingContext
  ): Promise<string>;

  /**
   * Get internal identifier for an external entity
   * Returns null if mapping doesn't exist
   */
  getInternalId(
    entityType: string,
    externalId: string,
    connectionId: string  // ✅ Connection ID
  ): Promise<string | null>;

  /**
   * Get external identifier(s) for an internal ID
   * Returns all connection-specific external IDs mapped to this internal ID
   */
  getExternalIds(
    entityType: string,
    internalId: string
  ): Promise<ExternalIdMapping[]>;

  /**
   * Create explicit mapping between external and internal identifiers
   * Used for manual mapping or when internal ID already exists
   */
  createMapping(
    entityType: string,
    externalId: string,
    connectionId: string,  // ✅ Connection ID
    internalId: string
  ): Promise<void>;

  /**
   * Batch get or create internal identifiers
   * Optimized for processing multiple entities at once
   */
  batchGetOrCreateInternalIds(
    requests: IdentifierMappingRequest[]
  ): Promise<Map<string, string>>; // externalId -> internalId
}

interface MappingContext {
  parentEntityType?: string;
  parentInternalId?: string;
  metadata?: Record<string, any>;
}

interface IdentifierMappingRequest {
  entityType: string;
  externalId: string;
  connectionId: string;  // ✅ Connection ID
  context?: MappingContext;
}

interface ExternalIdMapping {
  externalId: string;
  platformType: string;  // Denormalized from Connection
  connectionId: string;   // ✅ Connection ID
  entityType: string;
}
```

### Internal Identifier Format

Internal identifiers are generated from a **single unified seed** across all entity types:
- Format: `ol_{entityType}_{uuid}` or `ol_{sequentialId}` (implementation choice)
- Examples: `ol_product_abc123`, `ol_order_xyz789`, `ol_offer_def456`
- Uniqueness: Guaranteed across all entities in the system

### Usage by Adapters

**Adapters are responsible for**:
1. Fetching data from external platforms
2. Transforming data to OpenLinker unified schema
3. **Replacing external identifiers with internal identifiers** using `IdentifierMappingService`

**Example: PrestaShop Product Adapter**

```typescript
@Injectable()
export class PrestashopProductAdapter implements ProductMasterPort {
  constructor(
    private readonly identifierMapping: IdentifierMappingService,
    private readonly httpService: HttpService,
    private readonly connectionId: string, // ✅ Connection ID for this PrestaShop instance
  ) {}

  async getProduct(productId: string): Promise<Product> {
    // 1. Fetch product from PrestaShop API
    const prestashopProduct = await this.httpService.get(
      `/products/${productId}`
    );

    // 2. Transform to OpenLinker schema
    const product: Product = {
      // ... map PrestaShop fields to OpenLinker schema
      name: prestashopProduct.name,
      sku: prestashopProduct.reference,
      // ...
    };

    // 3. Replace external ID with internal ID (using connectionId)
    const internalId = await this.identifierMapping.getOrCreateInternalId(
      'Product',
      productId, // PrestaShop product ID
      this.connectionId // ✅ Connection ID (not platform type)
    );

    // 4. Use internal ID in the returned product
    return {
      ...product,
      id: internalId, // Internal OpenLinker ID
      externalIds: {
        prestashop: productId, // Keep external ID for reference
      },
    };
  }
}
```

**Example: Allegro Order Adapter**

```typescript
@Injectable()
export class AllegroOrderAdapter implements IMarketplaceIntegration {
  constructor(
    private readonly identifierMapping: IdentifierMappingService,
    private readonly connectionId: string, // ✅ Connection ID for this Allegro instance
  ) {}

  async getOrder(orderId: string): Promise<Order> {
    // 1. Fetch order from Allegro API
    const allegroOrder = await this.fetchFromAllegro(orderId);

    // 2. Transform to OpenLinker schema
    const order: Order = {
      // ... map Allegro order to OpenLinker schema
      items: allegroOrder.lineItems.map(item => ({
        // Map each item
        productId: await this.identifierMapping.getOrCreateInternalId(
          'Product',
          item.offerId, // Allegro offer ID
          this.connectionId, // ✅ Connection ID
          { parentEntityType: 'Order', parentInternalId: internalOrderId }
        ),
        quantity: item.quantity,
        // ...
      })),
    };

    // 3. Replace order ID
    const internalOrderId = await this.identifierMapping.getOrCreateInternalId(
      'Order',
      orderId, // Allegro order ID
      this.connectionId // ✅ Connection ID
    );

    return {
      ...order,
      id: internalOrderId,
      externalIds: {
        allegro: orderId,
      },
    };
  }
}
```

### Storage

Mappings are stored in PostgreSQL:

```typescript
// Connection entity
@Entity('connections')
class Connection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  platformType: string; // 'prestashop', 'allegro', etc.

  @Column()
  name: string;

  @Column()
  status: string; // 'active', 'disabled', 'error'

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, any>;

  @Column({ nullable: true })
  credentialsRef: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// Identifier mapping entity
@Entity('identifier_mappings')
class IdentifierMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  entityType: string; // 'Product', 'Order', 'Offer', etc.

  @Column()
  internalId: string; // OpenLinker internal ID

  @Column()
  externalId: string; // External platform ID

  @Column()
  platformType: string; // ✅ Denormalized from Connection (for query performance)

  @Column()
  connectionId: string; // ✅ References connections.id

  @Column({ type: 'jsonb', nullable: true })
  context: MappingContext;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // ✅ Unique constraint: entityType + platformType + connectionId + externalId
  @Index(['entityType', 'platformType', 'connectionId', 'externalId'], { unique: true })
  @Index(['entityType', 'internalId']) // Reverse lookup
}
```

**Why denormalize `platformType`?**
- **Query performance**: Avoids JOINs for common queries
- **Index efficiency**: Unique constraint includes `platformType` for faster lookups
- **Data integrity**: `platformType` is immutable on Connection, safe to denormalize

### Benefits

1. **Unified Identity**: All entities have consistent internal identifiers regardless of source
2. **Platform Agnostic**: Core domain logic works with internal IDs only
3. **Traceability**: Can always find external IDs from internal IDs and vice versa
4. **Adapter Responsibility**: Adapters handle ID translation, keeping core domain clean
5. **Single Source of Truth**: One service manages all identifier mappings

---

## Hexagonal Architecture Structure

Each domain module follows a standardized hexagonal structure:

```
libs/core/src/{domain}/
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
│       ├── product-master.port.ts
│       ├── inventory-master.port.ts
│       ├── order-processor-manager.port.ts
│       ├── product-repository.port.ts      # Repository ports (persistence contracts)
│       └── connection.port.ts
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
│   │   ├── prestashop-product-master.adapter.ts
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

### Layer Dependencies

```
interfaces → application → domain
     ↓           ↓
infrastructure → domain
```

**Rules**:
- **Domain** has **NO** dependencies on NestJS, TypeORM, or any framework code
- **Domain** depends only on **ports** (interfaces)
- **Application** depends on **domain** and **ports** (never on infrastructure)
- **Infrastructure** implements **ports** and depends on **domain**
- **Interfaces** depend on **application** and **infrastructure**

### Repository Ports Pattern

**Application services must never depend on concrete infrastructure repositories.** Instead, they depend on repository ports (interfaces) defined in the domain layer.

**Why:**
- Maintains proper dependency direction (application → domain, not application → infrastructure)
- Enables easy testing (mock the port interface)
- Allows swapping implementations (e.g., in-memory repository for tests)
- Follows Dependency Inversion Principle

**Pattern:**

1. **Define repository port in domain layer:**
   ```typescript
   // domain/ports/product-repository.port.ts
   export interface ProductRepositoryPort {
     findById(id: string): Promise<Product | null>;
     save(product: Product): Promise<Product>;
     // ... only methods needed by application services
   }
   ```

2. **Implement port in infrastructure layer:**
   ```typescript
   // infrastructure/persistence/repositories/product.repository.ts
   @Injectable()
   export class ProductRepository implements ProductRepositoryPort {
     // Implementation using TypeORM
   }
   ```

3. **Inject port (not concrete class) in application service:**
   ```typescript
   // application/services/product.service.ts
   @Injectable()
   export class ProductService {
     constructor(
       @Inject(PRODUCT_REPOSITORY_TOKEN)
       private readonly repository: ProductRepositoryPort, // ✅ Port interface
     ) {}
   }
   ```

4. **Bind in module with token:**
   ```typescript
   // product.module.ts
   export const PRODUCT_REPOSITORY_TOKEN = Symbol('ProductRepositoryPort');
   
   providers: [
     ProductRepository,
     {
       provide: PRODUCT_REPOSITORY_TOKEN,
       useExisting: ProductRepository,
     },
   ]
   ```

**ORM ↔ Domain Mapping:**

- **Mapping lives in infrastructure persistence layer** (repository or dedicated mapper)
- Application services work **only with domain entities**, never ORM entities
- Mapping methods (`toDomain`, `toOrm`) are **private** in repository (or extracted to mapper if reused)

✅ **Good:**
```typescript
// Repository handles mapping internally
@Injectable()
export class ProductRepository implements ProductRepositoryPort {
  async findById(id: string): Promise<Product | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null; // Private mapping method
  }
  
  private toDomain(entity: ProductOrmEntity): Product { ... }
  private toOrm(product: Product): ProductOrmEntity { ... }
}
```

❌ **Bad:**
```typescript
// Service imports infrastructure repository directly
import { ProductRepository } from '../infrastructure/persistence/repositories/product.repository';

// Service works with ORM entities
const ormEntity = await this.repository.findOrmEntity(id); // ❌
```

**Repository Error Handling:**

- **Repositories must throw domain errors, not infrastructure errors**
- Catch infrastructure-specific errors (TypeORM, database) and convert to domain exceptions
- Application services handle domain errors, not infrastructure errors

✅ **Good:**
```typescript
// Repository throws domain error
@Injectable()
export class ProductRepository implements ProductRepositoryPort {
  async insertMapping(mapping: IdentifierMapping): Promise<IdentifierMapping> {
    try {
      const saved = await this.ormRepository.save(this.toOrm(mapping));
      return this.toDomain(saved);
    } catch (error) {
      // Convert infrastructure error to domain error
      if (error instanceof QueryFailedError && error.message.includes('duplicate key')) {
        throw new DuplicateIdentifierMappingError(...); // ✅ Domain error
      }
      throw error;
    }
  }
}

// Service handles domain error
@Injectable()
export class ProductService {
  async createMapping(...) {
    try {
      await this.repository.insertMapping(mapping);
    } catch (error) {
      if (error instanceof DuplicateIdentifierMappingError) {
        // Handle domain error - no infrastructure awareness
      }
    }
  }
}
```

❌ **Bad:**
```typescript
// Repository port exposes infrastructure-specific error checking
export interface ProductRepositoryPort {
  insertMapping(...): Promise<...>;
  isUniqueViolationError(error: unknown): boolean; // ❌ Infrastructure-specific
}

// Service depends on infrastructure error types
catch (error) {
  if (error instanceof QueryFailedError) { // ❌ Infrastructure awareness
    // ...
  }
}
```

---

## Module Organization

### Monorepo Structure

```
openlinker/
├── apps/
│   ├── api/                         # Main NestJS API Application
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── auth/                # Authentication & Authorization
│   │   │   ├── sync/                # Synchronization orchestration
│   │   │   └── integrations/        # Integration modules
│   │   │       ├── allegro/
│   │   │       └── prestashop/
│   │   └── package.json
│   │
│   └── worker/                      # Background Workers (Future)
│       └── src/
│
├── libs/
│   ├── core/                        # Core Bounded Contexts
│   │   ├── src/
│   │   │   ├── products/
│   │   │   ├── inventory/
│   │   │   ├── orders/
│   │   │   ├── listings/
│   │   │   ├── identifier-mapping/
│   │   │   ├── sync/
│   │   │   └── events/
│   │   └── package.json
│   │
│   ├── shared/                      # Shared Utilities
│   │   ├── src/
│   │   │   ├── logging/
│   │   │   ├── config/
│   │   │   ├── errors/
│   │   │   └── types/
│   │   └── package.json
│   │
│   └── integrations/                # External Integrations (Optional)
│       ├── allegro/
│       ├── prestashop/
│       └── shopify/
│
├── schema.yaml                      # Unified Data Schema (OpenAPI)
├── pnpm-workspace.yaml
└── package.json
```

### Capability Assignment

Capability assignment is configured globally in the database (single instance). Multi-tenancy support will be added in the future.

**Configuration Table** (`capability_assignments`):
```typescript
{
  capability: 'ProductMaster' | 'InventoryMaster' | 'OrderProcessorManager' | 'PricingAuthority';
  adapterId: string;  // e.g., 'prestashop', 'openlinker'
  adapterType: string; // e.g., 'IShopIntegration'
  isActive: boolean;
  config: Record<string, any>; // Adapter-specific config
}
```

**Example Configuration**:
```typescript
// PrestaShop as ProductMaster, InventoryMaster and OrderProcessorManager
{
  capability: 'ProductMaster',
  adapterId: 'prestashop',
  adapterType: 'IShopIntegration',
  isActive: true
}

{
  capability: 'InventoryMaster',
  adapterId: 'prestashop',
  adapterType: 'IShopIntegration',
  isActive: true
}

{
  capability: 'OrderProcessorManager',
  adapterId: 'prestashop',
  adapterType: 'IShopIntegration',
  isActive: true
}
```

**Service Usage**:
```typescript
@Injectable()
export class ProductSyncService {
  constructor(
    private integrationsService: IntegrationsService,
  ) {}

  async syncProduct(productId: string) {
    // Get adapter assigned to ProductMaster role
    const productMaster = await this.integrationsService
      .getCapabilityAdapter<ProductMasterPort>('ProductMaster');
    
    // Use abstraction, not concrete implementation
    const product = await productMaster.getProduct(productId);
    // ... sync logic
  }
}

@Injectable()
export class InventorySyncService {
  constructor(
    private integrationsService: IntegrationsService,
  ) {}

  async syncInventory(productId: string) {
    // Get adapter assigned to InventoryMaster role
    const inventoryMaster = await this.integrationsService
      .getCapabilityAdapter<InventoryMasterPort>('InventoryMaster');
    
    // Use abstraction, not concrete implementation
    const inventory = await inventoryMaster.getInventory(productId);
    // ... sync logic
  }
}
```

---

## Data Flow

### 1. Order Synchronization Flow (Marketplace → Shop)

#### Polling Flow

```
Scheduled Job / Controller
    │
    │ @Cron('*/5 * * * *') or HTTP endpoint
    │ Initiates order synchronization process
    ▼
OrderSyncService.syncOrdersFromMarketplace()
    │
    │ Gets marketplace adapter(s) dynamically
    │ Gets OrderProcessorManagerPort adapter
    ▼
MarketplaceAdapter (AllegroAdapter)
    │
    │ getOrders(filters) - fetches new/updated orders
    ▼
Marketplace API (Allegro API)
    │
    │ Returns orders (with external IDs)
    ▼
MarketplaceAdapter (AllegroAdapter)
    │
    │ 1. Maps to unified Order schema
    │ 2. Uses IdentifierMappingService to replace external IDs with internal IDs
    │    - Order ID: external → internal
    │    - Product IDs in items: external → internal
    │    - Customer ID: external → internal
    ▼
OrderSyncService
    │
    │ Receives orders with internal IDs only
    │
    │ For each order:
    │   - Uses ProductMappingService
    │   - Uses StatusMappingService
    │   - Gets OrderProcessorManagerPort adapter
    ▼
OrderProcessorManagerPort (PrestashopOrderProcessorAdapter)
    │
    │ 1. Maps unified Order → PrestaShop format
    │ 2. Uses IdentifierMappingService.getExternalIds() to get PrestaShop IDs
    │    - Product IDs: internal → PrestaShop external IDs
    │    - Customer ID: internal → PrestaShop external ID
    │ 3. createOrder(orderCreate) with PrestaShop external IDs
    ▼
PrestaShop API
    │
    │ Returns created order
    ▼
OrderSyncService
    │
    │ Saves OrderMapping
    │ Updates sync status
```

#### Real-Time Flow

```
Marketplace API
    │
    │ (Webhook)
    ▼
MarketplaceAdapter
    │
    │ 1. Maps to unified Order schema
    │ 2. Uses IdentifierMappingService to replace external IDs with internal IDs
    │    - Order ID: external → internal
    │    - Product IDs: external → internal
    ▼
Event: 'marketplace.order.received'
    │
    │ Payload contains order with internal IDs
    ▼
OrderSyncListener
    │
    │ Gets OrderProcessorManagerPort adapter
    ▼
OrderSyncService.syncOrderFromEvent()
    │
    │ Uses ProductMappingService (for product references)
    │ Uses StatusMappingService (for status mapping)
    │ Order already has internal IDs from adapter
    ▼
OrderProcessorManagerPort (PrestashopOrderProcessorAdapter)
    │
    │ 1. Uses IdentifierMappingService.getExternalIds() to get PrestaShop IDs
    │    - Product IDs: internal → PrestaShop external IDs
    │    - Customer ID: internal → PrestaShop external ID
    │ 2. Maps unified Order → PrestaShop format
    │ 3. createOrder(orderCreate) with PrestaShop external IDs
    ▼
PrestaShop API
```

### 2. Inventory Synchronization Flow (Master → Slaves)

```
InventoryMasterPort (PrestashopInventoryMasterAdapter)
    │
    │ getInventory(productId)
    ▼
PrestaShop API
    │
    │ Returns inventory data
    ▼
InventorySyncService
    │
    │ Finds product mappings
    │ Calculates available quantity
    ▼
For each marketplace:
    │
    │ Gets marketplace adapter
    ▼
MarketplaceAdapter.updateOfferQuantity(offerId, quantity)
    │
    ▼
Allegro API / Amazon API / etc.
```

### 3. Event-Driven Flow

```
External System Event
    │
    ▼
Adapter (e.g., AllegroAdapter)
    │
    │ Emits domain event
    ▼
Event Bus (Redis Streams)
    │
    ▼
Event Handlers
    │
    ├─> OrderSyncListener
    ├─> InventorySyncListener
    └─> NotificationListener
```

---

## Technology Stack

### Core Technologies

- **Framework**: NestJS
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL (TypeORM)
- **Caching**: Redis
- **Event Bus**: Redis Streams (initial), RabbitMQ/Kafka (future)
- **Package Manager**: pnpm (monorepo)

### Key Libraries

- **HTTP Client**: Axios (`@nestjs/axios`)
- **Scheduling**: `@nestjs/schedule` (Cron jobs)
- **Events**: `@nestjs/event-emitter` (in-memory), Redis Streams (distributed)
- **Authentication**: JWT (`@nestjs/jwt`, `@nestjs/passport`)
- **Validation**: `class-validator`, `class-transformer`
- **Logging**: NestJS Logger (wrapped in shared library)

### Development Tools

- **Linting**: ESLint
- **Formatting**: Prettier
- **Testing**: Jest
- **Type Checking**: TypeScript (strict mode)

---

## Related Documentation

- [Engineering Standards](./engineering-standards.md) - Coding standards and conventions
- [AI Assistant Guide](./ai-assistant-guide.md) - Guide for AI coding assistants

