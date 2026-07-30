/**
 * MCP Tool Definitions Provider
 *
 * Assembles the Phase-1 tool catalogue (#1487) as a single injectable array.
 *
 * Tool factories take their core service directly rather than resolving it
 * from a container, so each tool file stays a pure function of its dependency
 * and is trivially unit-testable with a hand-rolled stub. This provider is the
 * one place that knows the full catalogue — adding a tool is one import plus
 * one array entry.
 *
 * Registration order is the order tools appear in `tools/list`; discovery
 * entry points come first so an agent reading the list top-down meets
 * `list_connections` before the tools that want a `connectionId`.
 *
 * @module apps/api/src/mcp/tools
 */
import type { Provider } from '@nestjs/common';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  INVENTORY_QUERY_SERVICE_TOKEN,
  type IInventoryQueryService,
} from '@openlinker/core/inventory';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';

import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../integrations/application/interfaces/connection.service.interface';
import type { McpToolDefinition } from './tool-definition.types';
import { createWhoamiTool } from './read/whoami.tool';
import { createListConnectionsTool } from './read/list-connections.tool';
import { createSearchCatalogTool } from './read/search-catalog.tool';
import { createGetProductTool } from './read/get-product.tool';
import { createGetAvailabilityTool } from './read/get-availability.tool';
import { createGetOrderTool } from './read/get-order.tool';

export const MCP_TOOL_DEFINITIONS_TOKEN = Symbol('McpToolDefinitions');

export const mcpToolDefinitionsProvider: Provider = {
  provide: MCP_TOOL_DEFINITIONS_TOKEN,
  inject: [
    CONNECTION_SERVICE_TOKEN,
    PRODUCTS_SERVICE_TOKEN,
    INVENTORY_QUERY_SERVICE_TOKEN,
    ORDER_RECORD_SERVICE_TOKEN,
  ],
  useFactory: (
    connectionService: IConnectionService,
    productsService: IProductsService,
    inventoryQueryService: IInventoryQueryService,
    orderRecordService: IOrderRecordService
  ): readonly McpToolDefinition[] => [
    // Discovery — always registered.
    createWhoamiTool(),
    createListConnectionsTool(connectionService),
    // Capability-gated domain reads.
    createSearchCatalogTool(productsService),
    createGetProductTool(productsService),
    createGetAvailabilityTool(inventoryQueryService),
    createGetOrderTool(orderRecordService),
  ],
};
