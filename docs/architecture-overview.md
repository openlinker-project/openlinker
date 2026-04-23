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
│  │  │  - OrderSourcePort                                 │  │   │
│  │  │  - OrderProcessorManagerPort                       │  │   │
│  │  │  - OfferManagerPort                                │  │   │
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
│  │  │  - PrestashopOrderSourceAdapter                    │  │   │
│  │  │  - PrestashopOrderProcessorAdapter                 │  │   │
│  │  │  - AllegroOrderSourceAdapter                       │  │   │
│  │  │  - AllegroOfferManagerAdapter                      │  │   │
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

Frontend-specific conventions for the separate UI application are documented in `docs/frontend-architecture.md`.

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
- **Barcode Storage**: EAN/GTIN are stored on `ProductVariant` (not `Product`), as variants are the canonical offer-link targets.
- **Simple Products**: Products without combinations produce a deterministic synthetic variant to ensure a stable mapping target.

### 3. Inventory
- **Responsibility**: Inventory synchronization, stock level management
- **Key Entities**: Inventory, InventoryAdjustment, InventoryMapping
- **Location**: `libs/core/src/inventory/`
- **Capability**: Uses `InventoryMasterPort` abstraction

### 4. Orders
- **Responsibility**: Order ingestion, synchronization, and lifecycle management
- **Key Entities**: Order, OrderMapping, OrderStatus, IncomingOrder
- **Location**: `libs/core/src/orders/`
- **Capabilities**:
  - `OrderSourcePort` — cursor-based order-event ingestion from marketplaces *and* shops (`listOrderFeed` + `getOrder({externalOrderId})`)
  - `OrderProcessorManagerPort` — order lifecycle on the destination shop (create / update-status / cancel / return)

### 5. Customers
- **Responsibility**: Customer identity resolution, customer projections, multi-origin identity management
- **Key Entities**: CustomerProjection, CustomerAddressProjection, DestinationAddressMapping
- **Location**: `libs/core/src/customers/`
- **Key Features**:
  - Customer identity resolution with email fallback mode
  - Multi-origin customer identity (same email across platforms → same internal customer)
  - Customer projections (Model C) for debugging and retry support
  - Configurable PII storage (hash-only mode for privacy compliance)
  - Address reuse tracking via destination address mappings
- **Identity Modes**:
  - `external_only`: Only use external buyer ID mapping (no email fallback)
  - `email_fallback`: Use email hash fallback if external mapping not found (may merge customers with shared emails)
- **Provisioning Model**: Destination-owned (Model A) - customers created in destination platform (e.g., PrestaShop)
- **Projection Model**: Lightweight internal storage (Model C) - non-authoritative projections for debugging

### 6. Listings (Offers)
- **Responsibility**: Marketplace offer/listing management, offer lifecycle, offer-to-product mapping
- **Key Entities**: Offer, Listing, OfferMapping, OfferStatus, OfferCreationRecord
- **Location**: `libs/core/src/listings/`
- **Capability**: Uses `OfferManagerPort` abstraction for offer operations (listing, quantity + field updates, offer creation, category directory, seller-policy discovery)
- **Key Features**:
  - Creating and updating offers on marketplaces
  - Managing offer quantities based on inventory
  - Offer-to-product mapping
  - Offer status synchronization
  - Price management for marketplace offers
- Offer mappings are populated via the `marketplace.offers.sync` job (pre-sync pipeline).
- Allegro offer sync uses `GET /sale/offer-events` with persisted cursor key `allegro.offers.lastEventId`.
- Offer linking by barcode uses master-catalog scoping and links only on unique matches.

### 7. Sync Manager
- **Responsibility**: Job scheduling and retry logic; workers execute jobs. **Sync orchestration policies live in core application services** (e.g., order ingestion, inventory propagation), not in worker handlers.
- **Key Services**: SyncJobService, RetryService, SchedulerService
- **Location**: `libs/core/src/sync/` (core sync infrastructure), `apps/worker/src/sync/` (job runners/handlers)

### 8. Event Bus / Messaging
- **Responsibility**: Event-driven communication between modules
- **Technology**: Redis Streams (initial), RabbitMQ/Kafka (future)
- **Location**: `libs/core/src/events/`

### 9. Identifier Mapping Service
- **Responsibility**: Centralized identifier mapping between external platform IDs and internal OpenLinker IDs
- **Key Services**: IdentifierMappingService
- **Location**: `libs/core/src/identifier-mapping/`
- **Key Features**:
  - Generates unique internal identifiers for all entities (single seed across entire system)
  - Maps external platform identifiers to internal OpenLinker identifiers
  - Context-aware mapping (entity type, platform, etc.)
  - Used by adapters to replace external IDs with internal IDs during data transformation
- **Architecture**: Core infrastructure service used by all adapters

### 10. Plugin Manager / Integrations
- **Responsibility**: Adapter registry, per-connection adapter resolution, capability validation
- **Key Services**: IntegrationsService, AdapterRegistryService, ConnectionService
- **Location**: `apps/api/src/integrations/` (API layer), `libs/core/src/integrations/` (core domain)

### 11. Logging & Monitoring
- **Responsibility**: Structured logging, metrics, tracing
- **Technology**: NestJS Logger, OpenTelemetry (future)
- **Location**: `libs/shared/src/logging/`

### 12. Content
- **Responsibility**: Per-product, per-channel (or master) content fields with draft write-through and conflict detection. First field key: `description`.
- **Key Entities**: `ProductContentField`
- **Location**: `libs/core/src/content/`
- **Capability**: Uses `ContentPublisherPort` for outbound publishing (master path resolves `ProductMasterPort` via the integrations registry; channel path is deferred to #339/#342).
- **Storage**: `product_content_field` table with two partial unique indexes (master vs channel) to honour Postgres' NULL-distinct uniqueness for the nullable `connection_id` column.
- **Conflict model**: optimistic — inbound reconcile sets `has_conflict=true` when an external version diverges while a draft is pending; re-saving the draft is treated as implicit acknowledgement and clears the flag.

### 13. AI
- **Responsibility**: Provider-agnostic LLM completions for content generation. No application services live here — the bounded context is a single capability port + types + exceptions.
- **Key Port**: `AiCompletionPort` (`complete(input) → result`)
- **Location**: `libs/core/src/ai/`
- **Adapter package**: `libs/integrations/ai/` (workspace `@openlinker/integrations-ai`) — ships `VercelAiCompletionAdapter` (Anthropic via `ai` + `@ai-sdk/anthropic`, with system-prompt cache control) and `FakeAiCompletionAdapter` for tests / offline dev.
- **Selection**: `OL_AI_PROVIDER` env (`anthropic` default; `fake` for tests). `AiIntegrationModule` is registered inside `apps/api/src/integrations/integrations.module.ts` alongside the other `@openlinker/integrations-*` modules.
- **Telemetry**: per-call structured log carrying `{ requestId, model, latencyMs, inputTokens, outputTokens, cachedInputTokens }`.
- **Worker registration**: deferred — no consumer of `AiCompletionPort` lives in `apps/worker/` yet; wiring lands with #341 / #342.

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

### OrderSourcePort

**Purpose**: Read-only, cursor-capable ingestion of orders from any source — marketplaces (Allegro event journal) *and* shops (PrestaShop `date_upd` watermark). Platform-neutral; the cursor is an opaque adapter-defined string.

**Interface**:
```typescript
interface OrderSourcePort {
  /**
   * List incremental order feed items (event journal).
   * `fromCursor` null = start from the beginning; `nextCursor` null = no more pages.
   */
  listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput>;

  /**
   * Hydrate a full order by source-native external id.
   * Returns an IncomingOrder; identifier mapping happens in core services.
   */
  getOrder(input: { externalOrderId: string }): Promise<IncomingOrder>;
}
```

**Current Implementations**: `AllegroOrderSourceAdapter`, `PrestashopOrderSourceAdapter`

**Future Implementations**: `ShopifyOrderSourceAdapter`, `WooCommerceOrderSourceAdapter`

### OfferManagerPort

**Purpose**: Base capability contract for marketplace offer/listing management. Split out of the legacy `MarketplacePort` (#328); the previously-optional methods were extracted into distinct capability interfaces (#337). The base port carries only the single method every marketplace adapter must implement.

**Interface**:
```typescript
interface OfferManagerPort {
  updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void>;
}
```

**Sub-capabilities** (in `libs/core/src/listings/domain/ports/capabilities/`):

Each is an independent interface + co-located `is{Capability}(adapter)` type guard. Adapters declare the capabilities they support via `implements OfferManagerPort, OfferLister, OfferCreator, …`; call sites narrow via the guard before invoking the method — after the guard TypeScript knows the method is present.

| Capability | Method |
|---|---|
| `OfferLister` | `listOffers(input)` |
| `OfferEventReader` | `listOfferEvents(input)` |
| `OfferQuantityBatchUpdater` | `updateOfferQuantitiesBatch(cmd)` |
| `OfferFieldUpdater` | `updateOfferFields(cmd)` |
| `CategoryBrowser` | `fetchCategories(parentId?)` |
| `CategoryBarcodeMatcher` | `matchCategoryByBarcode(barcode)` |
| `OfferCreator` | `createOffer(cmd)` |
| `SellerPoliciesReader` | `fetchSellerPolicies()` |

**Current Implementation**: `AllegroOfferManagerAdapter` (implements every capability except `OfferQuantityBatchUpdater`).

**Future Implementations**: `ShopifyOfferManagerAdapter`, `WooCommerceOfferManagerAdapter`, `EbayOfferManagerAdapter`.

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
- Format: `ol_{prefix}_{uuid}` where `prefix` defaults to `entityType.toLowerCase()`
- Examples: `ol_product_fce2df4d853f4499b955a6bb1a212bd1`, `ol_variant_e4b98e91340a44edb4892905db8810b1`, `ol_order_xyz789`, `ol_offer_def456`
- Uniqueness: Guaranteed across all entities in the system
- **Database Storage**: Internal IDs are stored as `TEXT` type in PostgreSQL (not UUID)
- **Prefix overrides**: A small `ENTITY_TYPE_ID_PREFIX` map in `identifier-mapping.types.ts` overrides the default for entity types where the documented prefix diverges from the lowercased class name. Today: `ProductVariant → variant` (so IDs are `ol_variant_*`, not `ol_productvariant_*`).
- **Canonical Entities**: Product, ProductVariant, InventoryItem use internal IDs as primary keys

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

**Example: Allegro Order Source Adapter**

```typescript
@Injectable()
export class AllegroOrderSourceAdapter implements OrderSourcePort {
  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IAllegroHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
  ) {}

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    // 1. Fetch incremental order events from Allegro
    const response = await this.httpClient.get<AllegroOrderEventsResponse>('/order/events', {
      queryParams: { from: input.fromCursor ?? undefined, limit: input.limit },
    });

    // 2. Dedupe by checkoutFormId, map to the neutral OrderFeedItem shape
    const items = this.buildFeedItems(response.data.events);

    // 3. Next cursor is Allegro-assigned (monotonic per seller)
    const nextCursor = response.data.lastEventId ?? items.at(-1)?.eventKey ?? input.fromCursor ?? null;

    return { items, nextCursor };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    // 1. Hydrate checkout-form from Allegro
    const checkoutForm = await this.httpClient.get<AllegroCheckoutForm>(
      `/order/checkout-forms/${input.externalOrderId}`,
    );

    // 2. Map to the neutral IncomingOrder DTO — identifier mapping happens
    //    downstream in OrderIngestionService, not in the adapter.
    return this.toIncomingOrder(checkoutForm.data);
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

## Customer Identity Resolution

OpenLinker provides a **customer identity resolution service** that enables multi-origin customer identity management. This allows the same customer to be recognized across different platforms (e.g., Allegro, PrestaShop direct orders) based on email address.

### Identity Resolution Modes

**External-Only Mode** (`OL_CUSTOMER_IDENTITY_MODE=external_only`):
- Only uses external buyer ID mapping (source connection scoped)
- No email fallback
- Each external buyer ID maps to a unique internal customer ID
- **Use Case**: When email sharing is common (families, businesses) and you want to avoid incorrect customer merging

**Email Fallback Mode** (`OL_CUSTOMER_IDENTITY_MODE=email_fallback`, default):
- Primary: External buyer ID mapping
- Fallback: Email hash lookup to link customers across origins
- Same email → same internal customer ID (across different platforms)
- **Use Case**: Better user experience, same customer recognized across platforms
- **Risk**: Shared emails (families, businesses) may incorrectly merge customers
- **Mitigation**: Collision policy creates new customer if >1 match (no merge)

### Customer Provisioning Model (Model A)

Customers are **destination-owned**: the destination platform (e.g., PrestaShop) is the source of truth for customer data. OpenLinker adapters are responsible for creating/updating customers in the external system.

**Example**: When an Allegro order arrives for a customer that doesn't exist in PrestaShop:
1. PrestaShop adapter provisions a guest customer (`is_guest=1`)
2. Customer is created with valid password (5-72 chars, PrestaShop hashes internally)
3. Customer ID is stored in identifier mappings for future reuse

### Customer Projection Model (Model C)

OpenLinker stores **lightweight, non-authoritative projections** of customer data for:
- **Debugging**: Track customer history across orders
- **Retry Support**: Enable order retry without re-fetching from source
- **Future Routing**: Support for future customer routing features

**Projection Storage**:
- `customer_projections`: Customer email hash, optional PII (name, email)
- `customer_address_projections`: Address hash, optional PII (address fields)
- `destination_address_mappings`: Maps internal customer + address hash → destination address ID

**PII Configuration** (`OL_STORE_PII`):
- `true` (default): Store raw PII (email, names, addresses)
- `false`: Store only hashes (emailHash, addressHash) - no raw PII
- **Note**: `emailHash` is always persisted regardless of PII setting

### Email Normalization

OpenLinker normalizes emails before hashing to handle platform-specific email formats:

**Allegro Masked Emails**:
- Format: `fixedPart+transactionId@allegromail.*`
- Normalization: Strip `+...` suffix before hashing
- Example: `8awgqyk6a5+cub31c122@allegromail.pl` → `8awgqyk6a5@allegromail.pl`
- **Why**: Transaction ID changes per order, but fixed part is stable per buyer

### Address Reuse

Addresses are reused across orders when identical (determined by hash):
- **Hash Components**: `address1`, `address2`, `city`, `postcode`, `countryIso2`
- **Reuse Priority**:
  1. Primary: Query `destination_address_mappings` table (fast, deterministic)
  2. Fallback: Query PrestaShop addresses and match by hash (recovery scenario)
- **Address Alias**: Deterministic alias format: `OL-{type}-{hash-prefix}` (e.g., `OL-shipping-a1b2c3`)

### Collision Handling

When `emailHash` matches multiple customers (collision):
- **Policy**: Create new internal customer (no merge)
- **Logging**: Warning logged with emailHash and match count
- **Result**: `collisionDetected=true` in resolution result
- **Rationale**: Prevents incorrect customer merging (shared emails in families/businesses)

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

### Capability Assignment (Implicit Capabilities)

OpenLinker uses **implicit capabilities**: capabilities are declared in code via adapter metadata, not stored in a database. Adapters are resolved per-connection at runtime.

**Key Principles**:
- ✅ **Per-Connection Resolution**: Each connection resolves its adapter independently
- ✅ **Code-Driven Capabilities**: Adapters declare supported capabilities in code (via Adapter Registry)
- ✅ **Multiple Connections Per Capability**: Multiple connections can support the same capability (e.g., multiple `OrderProcessorManager` connections)
- ✅ **Runtime Validation**: Capability support is validated at runtime when requested

**Connection Entity**:
```typescript
// Connection represents a configured integration instance
{
  id: string;                    // UUID
  platformType: string;          // 'prestashop', 'allegro', etc.
  name: string;                  // Human-readable name
  status: 'active' | 'disabled' | 'error';
  config: Record<string, any>;   // Platform-specific config
  credentialsRef: string;        // Reference to stored credentials
  adapterKey?: string;           // Optional explicit adapter key
  createdAt: Date;
  updatedAt: Date;
}
```

**Adapter Registry** (Code-Level):
```typescript
// Adapters declare their capabilities in code
{
  adapterKey: 'prestashop.webservice.v1',
  platformType: 'prestashop',
  supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager'],
  displayName: 'PrestaShop WebService v1',
  version: '1.0.0'
}

{
  adapterKey: 'allegro.publicapi.v1',
  platformType: 'allegro',
  supportedCapabilities: ['OrderSource', 'OfferManager'],
  displayName: 'Allegro Public API v1',
  version: '1.0.0'
}
```

**Service Usage** (Per-Connection):
```typescript
@Injectable()
export class ProductSyncService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private integrationsService: IntegrationsService,
  ) {}

  async syncProduct(connectionId: string, productId: string) {
    // Get ProductMaster adapter for specific connection
    const productMaster = await this.integrationsService
      .getCapabilityAdapter<ProductMasterPort>(connectionId, 'ProductMaster');
    
    // Use abstraction, not concrete implementation
    const product = await productMaster.getProduct(productId);
    // ... sync logic
  }
}

@Injectable()
export class InventorySyncService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private integrationsService: IntegrationsService,
  ) {}

  async syncInventory(connectionId: string, productId: string) {
    // Get InventoryMaster adapter for specific connection
    const inventoryMaster = await this.integrationsService
      .getCapabilityAdapter<InventoryMasterPort>(connectionId, 'InventoryMaster');
    
    // Use abstraction, not concrete implementation
    const inventory = await inventoryMaster.getInventory(productId);
    // ... sync logic
  }
}

@Injectable()
export class OrderSyncService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private integrationsService: IntegrationsService,
  ) {}

  async syncOrders() {
    // Get ALL OrderProcessorManager adapters (multiple connections)
    const orderProcessors = await this.integrationsService
      .listCapabilityAdapters<OrderProcessorManagerPort>({
        capability: 'OrderProcessorManager',
      });

    // Process orders from all sources
    for (const { connectionId, connection, adapter } of orderProcessors) {
      const orders = await adapter.getPendingOrders();
      // ... process orders from each connection
    }
  }
}
```

**Benefits**:
- ✅ **Multiple Connections**: Create multiple connections per platform type
- ✅ **Multiple Adapters Per Capability**: Support multiple `OrderProcessorManager` connections (e.g., PrestaShop + Allegro)
- ✅ **No Database Config**: Capabilities declared in code (type-safe, refactorable)
- ✅ **Runtime Validation**: Fail fast if capability unsupported
- ✅ **Per-Connection Configuration**: Each connection has its own config and credentials

**See Also**: [Connections & Adapter Resolution](./connections-and-adapter-resolution.md) for detailed documentation.

---

## Data Flow

### 1. Order Synchronization Flow (Marketplace → Shop)

#### Polling Flow

```
Scheduled Job / Controller
    │
    │ @Cron('*/5 * * * *') or HTTP endpoint
    │ Initiates order ingestion
    ▼
OrderIngestionService.ingestOrders()
    │
    │ Gets OrderSourcePort adapter for the connection
    │ (AllegroOrderSourceAdapter or PrestashopOrderSourceAdapter)
    ▼
OrderSourcePort.listOrderFeed({ fromCursor, limit })
    │
    │ cursor is opaque adapter-defined — Allegro event ID, PrestaShop date_upd
    ▼
Marketplace / Shop API
    │
    │ Returns order-event references (externalOrderId, eventKey, occurredAt)
    ▼
OrderIngestionService
    │
    │ 1. Enqueues one marketplace.order.sync job per feed item
    │ 2. Commits nextCursor only after successful enqueue (cursor-safety guard)
    ▼
OrdersPollHandler → OrderIngestionService.syncOrderFromSource()
    │
    │ 1. OrderSourcePort.getOrder({ externalOrderId }) → IncomingOrder
    │ 2. Resolves product / variant / customer identifiers via IdentifierMappingService
    │ 3. Builds unified Order and dispatches via OrderSyncService
    │ 4. Gets OrderProcessorManagerPort adapter for the destination shop
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
    │ Gets OfferManagerPort adapter for the target connection
    ▼
OfferManagerPort.updateOfferQuantity(cmd)
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

### 4. Webhook Ingestion Flow (Inbound → Event Bus → Sync Trigger)

```
External System (PrestaShop)
    │
    │ POST /webhooks/:provider/:connectionId
    │ Headers: X-OpenLinker-Timestamp, X-OpenLinker-Signature
    ▼
WebhookController
    │
    │ 1. Validates signature (HMAC SHA256)
    │ 2. Checks replay protection (timestamp window)
    │ 3. Performs deduplication (two-phase: processing → done)
    │ 4. Publishes to event bus
    ▼
Redis Streams: events.inbound.webhooks
    │
    │ EventEnvelope with InboundWebhookEvent
    ▼
WebhookToJobHandler (Consumer Group: webhook-handler)
    │
    │ 1. Consumes events from stream
    │ 2. Maps webhook event to sync job
    │ 3. Enqueues job with idempotency key
    │ 4. ACKs message after successful enqueue
    ▼
Redis Streams: jobs.sync
    │
    │ SyncJob (e.g., master.product.syncByExternalId)
    ▼
Future: Worker processes jobs
    │
    │ Triggers "pull" sync via adapter APIs
    │ (Webhook payload is not source of truth)
```

**Key Design Principles**:
- **Fast webhook processing**: Validate → enqueue → ACK (target: <100ms)
- **At-least-once delivery**: Two-phase deduplication prevents lost events
- **Idempotent job enqueue**: Job-level deduplication prevents duplicate sync jobs
- **Webhook payload is not source of truth**: Triggers "pull" jobs that fetch full data via adapters

**Security**:
- HMAC SHA256 signature verification using raw body bytes
- Replay protection via timestamp validation (±5 minute window)
- Connection validation (exists, active, provider match)

**Location**: `apps/api/src/webhooks/` (Infrastructure / Inbound Adapters)

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

- **HTTP Client**: 
  - **Adapter HTTP clients**: Axios (`@nestjs/axios`) - used for integration adapters requiring retries, rate limiting, and structured logging
  - **Simple HTTP calls**: Native `fetch()` API (Node.js 18+) - acceptable for one-off calls like OAuth token exchange
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

