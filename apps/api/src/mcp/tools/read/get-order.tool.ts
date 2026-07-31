/**
 * `get_order` MCP Tool
 *
 * Reads one order from OpenLinker's OWN order store (`OrderRecord`), not from
 * the originating marketplace.
 *
 * WHY NOT `OrderSourcePort.getOrder` (plan §3.3): that port is an INGESTION
 * seam. Using it here would (a) make one live marketplace API call per tool
 * invocation, spending the operator's rate-limit budget on an agent's behalf,
 * (b) return external-id-keyed data that won't join with the internal-id-keyed
 * product tools, and (c) re-fetch raw buyer PII from the platform regardless of
 * the operator's `OL_STORE_PII` setting — defeating it entirely.
 *
 * PII, TWO LAYERS:
 *   1. `IOrderRecordService.persistOrder` already nulls buyer PII in the
 *      snapshot when the operator disables PII storage. Reading the record
 *      inherits that decision for free.
 *   2. This tool ADDITIONALLY declines to forward buyer identity even when it
 *      IS stored: the projection below is an explicit allowlist that omits
 *      `customerEmail`, `shippingAddress`, and `billingAddress`. An MCP result
 *      is handed to an external LLM provider acting as a de-facto
 *      sub-processor, and order *status* — the operational question an agent
 *      actually asks — does not require the buyer's identity to answer.
 *
 * Never dump `orderSnapshot` wholesale: it is a free-form `Record<string,
 * unknown>` whose shape grows over time, so an allowlist is the only
 * projection that stays safe as fields are added.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { IOrderRecordService, OrderRecord } from '@openlinker/core/orders';

import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult, toolFailure } from './tool-result';

const inputSchema = z.object({
  orderId: z.string().describe('Internal OpenLinker order id, e.g. ol_order_… .'),
});

export function createGetOrderTool(orderRecordService: IOrderRecordService): McpToolDefinition {
  return {
    name: 'get_order',
    requiredCapability: 'OrderSource',
    requiredScope: 'mcp:read',
    requiresAdmin: false,
    description:
      "Read one order from OpenLinker's order store by its internal id: status, sync state, fulfillment/payment state, dispatch deadline, totals, and line items. Buyer personal data (name, email, address) is deliberately NOT returned. Reflects the last completed order sync, not a live marketplace read.",
    inputSchema,
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      // NARROWING, not validation: the SDK already validated `args` against
      // this schema before invoking the handler, so this call cannot
      // realistically fail. It exists to turn `Record<string, unknown>` into
      // typed fields — never rely on it as the enforcement point for a
      // constraint (a caller-visible cap belongs on the schema itself).
      const { orderId } = inputSchema.parse(args);

      const record = await orderRecordService.getOrderRecord(orderId);
      if (record === null) {
        return toolFailure(`No order found with id "${orderId}".`);
      }

      return jsonResult(projectOrderRecord(record));
    },
  };
}

function projectOrderRecord(record: OrderRecord): Record<string, unknown> {
  const snapshot = record.orderSnapshot;

  return {
    internalOrderId: record.internalOrderId,
    sourceConnectionId: record.sourceConnectionId,
    recordStatus: record.recordStatus,
    syncStatus: record.syncStatus,
    fulfillmentState: record.fulfillmentState,
    paymentStatus: record.paymentStatus ?? null,
    dispatchByAt: record.dispatchByAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    // --- Allowlisted snapshot fields. NO buyer identity. ---
    orderNumber: readString(snapshot, 'orderNumber'),
    status: readString(snapshot, 'status'),
    totals: snapshot.totals ?? null,
    items: projectItems(snapshot.items),
  };
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Line items, projected to the commercial fields. Deliberately field-by-field
 * rather than pass-through: an `OrderItem` may grow buyer-linked fields later,
 * and a spread would silently start forwarding them.
 */
function projectItems(items: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      sku: record.sku ?? null,
      name: record.name ?? null,
      quantity: record.quantity ?? null,
      unitPrice: record.unitPrice ?? null,
      productId: record.productId ?? null,
      variantId: record.variantId ?? null,
    };
  });
}
