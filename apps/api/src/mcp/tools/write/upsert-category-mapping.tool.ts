/**
 * `upsert_category_mapping` MCP Tool
 *
 * The first WRITE tool on OL's MCP surface (#1488): creates or updates one
 * operator category mapping.
 *
 * WHY A WRITE IS ACCEPTABLE HERE WITHOUT SERVER-ENFORCED TWO-PHASE CONFIRM
 * (ADR-034): a category mapping is correctable, carries no secrets, and is
 * scoped to a single destination connection. v1 human-in-the-loop is the MCP
 * client's own tool-approval UX plus the coarse consent implied by an operator
 * minting and installing an admin-scoped, write-scoped token. Server-enforced
 * two-phase confirmation is the deferred hardening for the higher-blast-radius
 * config writes in #1489 — recorded here so that phase does not re-derive it.
 *
 * ⚠️ `sourceConnectionId` IS REQUIRED HERE, though the core
 * `CategoryMappingInput` marks it optional. That optionality is a documented
 * #1036 record-only gap ("the API create path doesn't yet supply it"), and this
 * tool must not inherit it, because of how the two persistence paths differ:
 *
 *   - `CategoryMappingRepository.upsertMapping` matches on `sourceConnectionId`
 *     with `IsNull()` semantics, so omitting it only ever matches NULL rows —
 *     against an operator-authored row that carries a source connection it does
 *     not update, it INSERTS A SECOND ROW.
 *   - `findBySourceCategory` (the resolve path) is oldest-wins across the now
 *     ambiguous pair, logging "Ambiguous category mapping".
 *
 * So the agent's write would report success while having NO EFFECT on
 * resolution (the operator's older row keeps winning) and would silently
 * degrade that destination's mapping table. Requiring the field costs one
 * schema field and makes the write either hit the intended row or fail loudly.
 * Widening the core type is #1036 follow-up work owned by the mappings context.
 *
 * @module apps/api/src/mcp/tools/write
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { CategoryMapping, IMappingConfigService } from '@openlinker/core/mappings';

import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult } from '../read/tool-result';

export function createUpsertCategoryMappingTool(
  mappingConfigService: IMappingConfigService
): McpToolDefinition {
  return {
    name: 'upsert_category_mapping',
    requiredCapability: null,
    requiredScope: 'mcp:write',
    requiresAdmin: true,
    description:
      'Create or update one category mapping for a destination connection, so future listings from that source category are placed in the given destination category. Requires a write-scoped token owned by an admin. Show the operator the mapping you intend to write and get confirmation before calling this. Re-read with list_category_mappings afterwards to confirm what was stored.',
    inputSchema: z.object({
      destinationConnectionId: z
        .string()
        .describe('Destination connection id, from list_connections.'),
      sourceConnectionId: z
        .string()
        .describe(
          'Source (master) connection id that owns the source category. Required: omitting it would create a duplicate row rather than updating the intended one.'
        ),
      sourceCategoryId: z.string().describe('Category id on the source platform.'),
      destinationCategoryId: z.string().describe('Category id on the destination platform.'),
      destinationCategoryName: z.string().describe('Human-readable destination category name.'),
      destinationCategoryPath: z
        .string()
        .optional()
        .describe('Full destination category breadcrumb, when known.'),
    }),
    handler: async (args): Promise<CallToolResult> => {
      const mapping = await mappingConfigService.upsertCategoryMapping(
        args.destinationConnectionId as string,
        {
          sourceCategoryId: args.sourceCategoryId as string,
          destinationCategoryId: args.destinationCategoryId as string,
          destinationCategoryName: args.destinationCategoryName as string,
          destinationCategoryPath: args.destinationCategoryPath as string | undefined,
          sourceConnectionId: args.sourceConnectionId as string,
        }
      );
      return jsonResult(projectCategoryMapping(mapping));
    },
  };
}

function projectCategoryMapping(mapping: CategoryMapping): Record<string, unknown> {
  return {
    id: mapping.id,
    sourceConnectionId: mapping.sourceConnectionId,
    sourceCategoryId: mapping.sourceCategoryId,
    destinationCategoryId: mapping.destinationCategoryId,
    destinationCategoryName: mapping.destinationCategoryName,
    destinationCategoryPath: mapping.destinationCategoryPath,
    destinationTaxonomyProvenance: mapping.destinationTaxonomyProvenance,
  };
}
