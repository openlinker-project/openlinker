# Connections & Adapter Resolution

This document describes the Connections and Adapter Resolution system in OpenLinker, which enables per-connection adapter resolution using implicit capabilities (code-driven capability declarations).

## Table of Contents

1. [Overview](#overview)
2. [Key Concepts](#key-concepts)
3. [Connection Entity](#connection-entity)
4. [Adapter Registry](#adapter-registry)
5. [Adapter Resolution](#adapter-resolution)
6. [Usage Examples](#usage-examples)
7. [Multiple Adapters Per Capability](#multiple-adapters-per-capability)
8. [API Reference](#api-reference)

---

## Overview

OpenLinker uses a **connection-based adapter resolution** system where:

- **Connections** represent configured integration instances (e.g., a specific PrestaShop store, a specific Allegro account)
- **Adapters** are resolved per-connection at runtime
- **Capabilities** are declared implicitly in code (no database assignment table)
- **Multiple connections** can support the same capability (e.g., multiple `OrderProcessorManager` connections)

This approach enables:
- ✅ Multiple connections per platform type
- ✅ Multiple adapters per capability
- ✅ Per-connection configuration
- ✅ Runtime capability validation
- ✅ No database-driven capability assignments

---

## Key Concepts

### Connection

A **Connection** represents a configured integration instance. Each connection has:
- `id`: Unique identifier (UUID)
- `platformType`: Platform identifier (e.g., `'prestashop'`, `'allegro'`)
- `name`: Human-readable name
- `status`: `'active'` | `'disabled'` | `'error'`
- `config`: Platform-specific configuration (JSONB)
- `credentialsRef`: Reference to stored credentials
- `adapterKey`: Optional explicit adapter key (e.g., `'prestashop.webservice.v1'`)
- `createdAt`, `updatedAt`: Timestamps

**Example:**
```typescript
const connection = new Connection(
  'connection-123',
  'prestashop',
  'Main PrestaShop Store',
  'active',
  { baseUrl: 'https://example.com', shopId: '123' },
  'cred_prestashop_001',
  new Date(),
  new Date(),
  'prestashop.webservice.v1' // Optional explicit adapterKey
);
```

### Adapter Key

An **adapter key** is a versioned identifier for an adapter implementation (e.g., `'prestashop.webservice.v1'`, `'allegro.publicapi.v1'`).

- **Explicit**: Set on the connection (`connection.adapterKey`)
- **Derived**: Automatically determined from `platformType` if not set
- **Versioned**: Includes version suffix (`.v1`, `.v2`) for future compatibility

**Derivation Logic** (MVP - hardcoded, designed for easy configuration):
```typescript
prestashop → 'prestashop.webservice.v1'
allegro → 'allegro.publicapi.v1'
```

### Capability

A **Capability** represents a business role that adapters can support:
- `'ProductMaster'`: Product data management
- `'InventoryMaster'`: Inventory management
- `'OrderProcessorManager'`: Order processing
- `'Marketplace'`: Marketplace integration

Capabilities are declared in adapter metadata (code-level), not stored in the database.

### Adapter Metadata

Each adapter declares its supported capabilities in code:

```typescript
{
  adapterKey: 'prestashop.webservice.v1',
  platformType: 'prestashop',
  supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager'],
  displayName: 'PrestaShop WebService v1',
  version: '1.0.0'
}
```

---

## Connection Entity

### Domain Entity

**Location**: `libs/core/src/identifier-mapping/domain/entities/connection.entity.ts`

```typescript
export class Connection {
  constructor(
    public readonly id: string,
    public readonly platformType: PlatformType,
    public readonly name: string,
    public readonly status: ConnectionStatus,
    public readonly config: ConnectionConfig,
    public readonly credentialsRef: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly adapterKey?: string, // Optional
  ) {}
}
```

### CRUD Operations

**Port Interface**: `ConnectionPort`

```typescript
export interface ConnectionPort {
  get(connectionId: string): Promise<Connection>;
  list(filters?: ConnectionFilters): Promise<Connection[]>;
  create(payload: ConnectionCreate): Promise<Connection>;
  update(connectionId: string, patch: ConnectionUpdate): Promise<Connection>;
  disable(connectionId: string): Promise<Connection>;
}
```

**Repository**: `ConnectionRepository` (implements `ConnectionPort`)

---

## Adapter Registry

The **Adapter Registry** is a code-level static registry of adapters and their capabilities.

### Registry Structure

**Location**: `libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts`

**Current Adapters** (MVP):
- `prestashop.webservice.v1`: Supports `['ProductMaster', 'InventoryMaster', 'OrderProcessorManager']`
- `allegro.publicapi.v1`: Supports `['Marketplace', 'OrderProcessorManager']`

### Registry Port

```typescript
export interface AdapterRegistryPort {
  getAdapter(adapterKey: string): Promise<AdapterInstance>;
  getAdapterMetadata(adapterKey: string): Promise<AdapterMetadata>;
  listAdapters(): Promise<AdapterMetadata[]>;
}
```

### Adding New Adapters

To add a new adapter, update `AdapterRegistryService`:

```typescript
private readonly registry: Map<string, AdapterMetadata> = new Map([
  // ... existing adapters
  {
    adapterKey: 'shopify.restapi.v1',
    platformType: 'shopify',
    supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
    displayName: 'Shopify REST API v1',
    version: '1.0.0',
  },
].map((meta) => [meta.adapterKey, meta]));
```

**Future Enhancement**: Dynamic registration or database-backed registry.

---

## Adapter Resolution

The **IntegrationsService** resolves adapters for connections at runtime.

### Resolution Flow

1. **Resolve Connection**: Load connection by ID
2. **Validate Status**: Ensure connection is `'active'` (not `'disabled'`)
3. **Determine Adapter Key**:
   - Use `connection.adapterKey` if set (explicit)
   - Otherwise derive from `connection.platformType` (implicit)
4. **Load Adapter**: Retrieve adapter instance and metadata from registry
5. **Validate Capability** (if requested): Ensure adapter supports the capability

### Service Interface

**Location**: `libs/core/src/integrations/application/services/integrations.service.ts`

```typescript
export interface IIntegrationsService {
  // Get adapter for a connection
  getAdapter(connectionId: string): Promise<{
    connection: Connection;
    adapter: AdapterInstance;
    metadata: AdapterMetadata;
  }>;

  // Get capability adapter (validates capability support)
  getCapabilityAdapter<T>(connectionId: string, capability: Capability): Promise<T>;

  // List all adapters supporting a capability
  listCapabilityAdapters<T>(filters: {
    capability: Capability;
    platformType?: string;
  }): Promise<Array<{
    connectionId: string;
    connection: Connection;
    adapter: T;
    metadata: AdapterMetadata;
  }>>;
}
```

---

## Usage Examples

### Example 1: Get Adapter for Connection

```typescript
@Injectable()
export class ProductSyncService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IntegrationsService,
  ) {}

  async syncProduct(connectionId: string, productId: string) {
    // Resolve adapter for connection
    const { connection, adapter, metadata } = await this.integrationsService
      .getAdapter(connectionId);

    console.log(`Using adapter: ${metadata.adapterKey}`);
    console.log(`Supported capabilities: ${metadata.supportedCapabilities.join(', ')}`);

    // Use adapter (placeholder in MVP)
    // const productMaster = adapter as ProductMasterPort;
    // const product = await productMaster.getProduct(productId);
  }
}
```

### Example 2: Get Capability Adapter

```typescript
@Injectable()
export class InventorySyncService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IntegrationsService,
  ) {}

  async syncInventory(connectionId: string, productId: string) {
    // Get InventoryMaster adapter (validates capability support)
    const inventoryMaster = await this.integrationsService
      .getCapabilityAdapter<InventoryMasterPort>(connectionId, 'InventoryMaster');

    // Use abstraction, not concrete implementation
    const inventory = await inventoryMaster.getInventory(productId);
    // ... sync logic
  }
}
```

### Example 3: Multiple OrderProcessorManagers

```typescript
@Injectable()
export class OrderSyncService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IntegrationsService,
  ) {}

  async syncOrders() {
    // Get ALL OrderProcessorManager adapters (PrestaShop + Allegro)
    const orderProcessors = await this.integrationsService
      .listCapabilityAdapters<OrderProcessorManagerPort>({
        capability: 'OrderProcessorManager',
      });

    // Process orders from all sources
    for (const { connectionId, connection, adapter } of orderProcessors) {
      console.log(`Processing orders from: ${connection.name} (${connection.platformType})`);
      
      const orders = await adapter.getPendingOrders();
      // ... process orders
    }
  }
}
```

### Example 4: Filter by Platform Type

```typescript
// Get only PrestaShop OrderProcessorManagers
const prestashopOrderProcessors = await this.integrationsService
  .listCapabilityAdapters<OrderProcessorManagerPort>({
    capability: 'OrderProcessorManager',
    platformType: 'prestashop',
  });
```

---

## Multiple Adapters Per Capability

A key feature of the system is **multiple adapters per capability**. This enables:

- **Multiple OrderProcessorManagers**: PrestaShop + Allegro both process orders
- **Multiple ProductMasters**: Different shops as product sources
- **Multiple InventoryMasters**: Centralized inventory from multiple sources

### Use Case: Multiple Order Processors

**Scenario**: You have:
- Connection 1: PrestaShop store (supports `OrderProcessorManager`)
- Connection 2: Allegro marketplace (supports `OrderProcessorManager`)

**Code**:
```typescript
// Get all OrderProcessorManagers
const processors = await integrationsService.listCapabilityAdapters<OrderProcessorManagerPort>({
  capability: 'OrderProcessorManager',
});

// processors.length === 2
// processors[0].connection.platformType === 'prestashop'
// processors[1].connection.platformType === 'allegro'
```

**Benefits**:
- Process orders from multiple sources in a single operation
- No hardcoded adapter selection
- Easy to add new order sources

---

## API Reference

### REST API Endpoints

#### Create Connection

```http
POST /connections
Content-Type: application/json

{
  "name": "Main PrestaShop Store",
  "platformType": "prestashop",
  "config": {
    "baseUrl": "https://example.com",
    "shopId": "123"
  },
  "credentialsRef": "cred_prestashop_001",
  "adapterKey": "prestashop.webservice.v1" // Optional
}
```

#### List Connections

```http
GET /connections
GET /connections?platformType=prestashop
GET /connections?status=active
GET /connections?platformType=prestashop&status=active
```

#### Get Connection

```http
GET /connections/{id}
```

#### Update Connection

```http
PATCH /connections/{id}
Content-Type: application/json

{
  "name": "Updated Store Name",
  "status": "disabled",
  "adapterKey": "prestashop.webservice.v2"
}
```

#### Disable Connection

```http
PATCH /connections/{id}/disable
```

#### List Adapters

```http
GET /adapters
```

Returns all registered adapters with their metadata and supported capabilities.

---

## Error Handling

### Domain Exceptions

- **`ConnectionNotFoundException`**: Connection does not exist
- **`ConnectionDisabledException`**: Connection is disabled
- **`AdapterNotFoundException`**: Adapter key not found in registry
- **`CapabilityNotSupportedException`**: Adapter doesn't support requested capability

### HTTP Exceptions

Domain exceptions are converted to HTTP exceptions in the API layer:
- `ConnectionNotFoundException` → `404 Not Found`
- `ConnectionDisabledException` → `400 Bad Request` (or custom status)
- Other exceptions → `500 Internal Server Error`

---

## Design Decisions

### Why Implicit Capabilities (Option 2)?

**Benefits**:
- ✅ No database table for capability assignments
- ✅ Capabilities declared in code (type-safe, refactorable)
- ✅ Multiple connections per capability (natural)
- ✅ Runtime validation (fail fast if capability unsupported)
- ✅ Easier testing (no database setup for capability config)

**Trade-offs**:
- ❌ Capability changes require code deployment (not runtime configurable)
- ❌ No UI for capability assignment (future enhancement)

### Why Per-Connection Adapter Resolution?

**Benefits**:
- ✅ Multiple connections per platform type
- ✅ Per-connection configuration
- ✅ Easy to add new connections
- ✅ Connection-specific adapter versions

**Example**:
- Connection 1: PrestaShop Store A → `prestashop.webservice.v1`
- Connection 2: PrestaShop Store B → `prestashop.webservice.v2` (different version)

---

## Future Enhancements

1. **Dynamic Adapter Registration**: Load adapters from plugins/packages
2. **Database-Backed Registry**: Store adapter metadata in database
3. **UI for Capability Assignment**: Admin interface for managing capabilities
4. **Adapter Versioning**: Support multiple adapter versions per platform
5. **Connection Templates**: Pre-configured connection templates
6. **Connection Health Monitoring**: Track connection status and errors

---

## Related Documentation

- [Architecture Overview](./architecture-overview.md) - System architecture and capability abstractions
- [Engineering Standards](./engineering-standards.md) - Coding standards and patterns
- [Implementation Plan](./implementation-plan-connections-adapter-resolution.md) - Detailed implementation guide



