/**
 * Mapping-assistant MCP Tool Unit Tests (#1488)
 *
 * Covers the five tools' reads, their projections, and the two invariants that
 * would otherwise fail silently:
 *
 *  - `resolve_category` must never report `method: 'provision'` — the guard
 *    that turns #1041 into a red build instead of a read-scoped token quietly
 *    gaining a destination write.
 *  - `upsert_category_mapping` must require `sourceConnectionId`, or an agent
 *    write inserts a duplicate row and reports success while changing nothing.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import { CategoryMapping, AttributeMapping } from '@openlinker/core/mappings';
import { AttributeValueMapping } from '@openlinker/core/mappings';
import type {
  IAttributeProjectionService,
  ICategoryResolutionService,
} from '@openlinker/core/listings';
// The real service, for the provision-escalation guard below — a mock could
// only assert itself.
import { CategoryResolutionService } from '@openlinker/core/listings/services';
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { createListCategoryMappingsTool } from './read/list-category-mappings.tool';
import { createListAttributeMappingsTool } from './read/list-attribute-mappings.tool';
import { createResolveCategoryTool } from './read/resolve-category.tool';
import { createProjectAttributesTool } from './read/project-attributes.tool';
import { createUpsertCategoryMappingTool } from './write/upsert-category-mapping.tool';

const CTX = {} as never;

/**
 * A destination that resolves under neither capability, so
 * `resolveDestinationContext` falls back to the marketplace default and adds no
 * borrowed taxonomy — the shape most of these cases care about.
 */
function noDestination(): IIntegrationsService {
  return {
    getCapabilityAdapter: jest.fn().mockRejectedValue(new Error('no adapter')),
  } as unknown as IIntegrationsService;
}

/** A destination that borrows the given owner taxonomy (#1045, Erli-shaped). */
function borrowingDestination(owner: string): IIntegrationsService {
  return {
    getCapabilityAdapter: jest.fn().mockImplementation((_id: string, capability: string) => {
      if (capability !== 'OfferManager') {
        return Promise.reject(new Error('unsupported'));
      }
      return Promise.resolve({
        updateOfferQuantity: jest.fn(),
        getBorrowedTaxonomy: () => owner,
      });
    }),
  } as unknown as IIntegrationsService;
}

/** A shop: supports ProductPublisher, does NOT support OfferManager. */
function shopDestination(): IIntegrationsService {
  return {
    getCapabilityAdapter: jest.fn().mockImplementation((_id: string, capability: string) => {
      if (capability !== 'ProductPublisher') {
        return Promise.reject(new Error('CapabilityNotSupportedException'));
      }
      return Promise.resolve({ publishProduct: jest.fn() });
    }),
  } as unknown as IIntegrationsService;
}

function parse(result: CallToolResult): unknown {
  const block = result.content[0] as { type: string; text: string };
  return JSON.parse(block.text);
}

describe('mapping-assistant MCP tools', () => {
  describe('list_category_mappings', () => {
    it('should project only the allowlisted fields of each mapping', async () => {
      const mapping = new CategoryMapping(
        'cm-1',
        'src-conn',
        'dst-conn',
        '42',
        '77',
        'Shoes',
        'Fashion > Shoes',
        'allegro'
      );
      const service = {
        getCategoryMappings: jest.fn().mockResolvedValue([mapping]),
      } as unknown as IMappingConfigService;
      const tool = createListCategoryMappingsTool(service);

      const rows = parse(
        await tool.handler({ destinationConnectionId: 'dst-conn' }, CTX)
      ) as Record<string, unknown>[];

      expect(service.getCategoryMappings).toHaveBeenCalledWith('dst-conn');
      expect(rows[0]).toEqual({
        id: 'cm-1',
        sourceConnectionId: 'src-conn',
        sourceCategoryId: '42',
        destinationCategoryId: '77',
        destinationCategoryName: 'Shoes',
        destinationCategoryPath: 'Fashion > Shoes',
        destinationTaxonomyProvenance: 'allegro',
      });
      // The destination connection is already the argument; echoing it back
      // would be redundant, and the projection is an allowlist by design.
      expect(rows[0]).not.toHaveProperty('destinationConnectionId');
    });

    it('should declare itself a read tool that needs no admin', () => {
      const tool = createListCategoryMappingsTool({} as IMappingConfigService);

      expect(tool.requiredScope).toBe('mcp:read');
      expect(tool.requiresAdmin).toBe(false);
    });
  });

  describe('list_attribute_mappings', () => {
    it('should enumerate value remaps rather than spreading them', async () => {
      const mapping = new AttributeMapping(
        'am-1',
        'src-conn',
        'dst-conn',
        'Color',
        'Kolor',
        '77',
        [new AttributeValueMapping('v-1', 'am-1', 'Red', 'Czerwony')],
        'allegro'
      );
      const service = {
        getAttributeMappings: jest.fn().mockResolvedValue([mapping]),
      } as unknown as IMappingConfigService;
      const tool = createListAttributeMappingsTool(service);

      const rows = parse(
        await tool.handler({ destinationConnectionId: 'dst-conn' }, CTX)
      ) as Record<string, unknown>[];

      expect(rows[0].values).toEqual([{ sourceValue: 'Red', destinationValue: 'Czerwony' }]);
      // Internal join keys must not reach an external LLM provider.
      expect(JSON.stringify(rows[0])).not.toContain('attributeMappingId');
    });
  });

  describe('resolve_category', () => {
    it('should forward the resolution inputs and project the outcome', async () => {
      const service = {
        resolveCategory: jest.fn().mockResolvedValue({
          destinationCategoryId: '77',
          provenance: 'owns',
          method: 'category_mapping',
        }),
      } as unknown as ICategoryResolutionService;
      const tool = createResolveCategoryTool(service, noDestination());

      const result = parse(
        await tool.handler(
          {
            destinationConnectionId: 'dst-conn',
            barcode: '5901234123457',
            sourceCategoryIds: ['9', '4'],
            sourceConnectionId: 'src-conn',
          },
          CTX
        )
      );

      expect(service.resolveCategory).toHaveBeenCalledWith({
        connectionId: 'dst-conn',
        barcode: '5901234123457',
        sourceCategoryIds: ['9', '4'],
        sourceConnectionId: 'src-conn',
      });
      expect(result).toEqual({
        destinationCategoryId: '77',
        provenance: 'owns',
        method: 'category_mapping',
      });
    });

    it('should pass a null barcode when none is supplied, so auto-detect is skipped', async () => {
      const service = {
        resolveCategory: jest
          .fn()
          .mockResolvedValue({ destinationCategoryId: null, provenance: null, method: 'manual' }),
      } as unknown as ICategoryResolutionService;
      const tool = createResolveCategoryTool(service, noDestination());

      await tool.handler({ destinationConnectionId: 'dst-conn' }, CTX);

      expect(service.resolveCategory).toHaveBeenCalledWith(
        expect.objectContaining({ barcode: null })
      );
    });

    /**
     * #1045 — a borrowing destination (Erli) resolves against the OWNER's
     * mappings. Dropping this made the tool report `manual` for a connection
     * the operator had already mapped via the owner, which would lead the
     * agent to author a redundant row.
     */
    it('should thread the borrowed taxonomy for a borrowing destination', async () => {
      const service = {
        resolveCategory: jest.fn().mockResolvedValue({
          destinationCategoryId: '77',
          provenance: 'borrows',
          method: 'category_mapping',
        }),
      } as unknown as ICategoryResolutionService;
      const tool = createResolveCategoryTool(service, borrowingDestination('allegro'));

      await tool.handler({ destinationConnectionId: 'erli-conn' }, CTX);

      expect(service.resolveCategory).toHaveBeenCalledWith(
        expect.objectContaining({ borrowedTaxonomy: 'allegro' })
      );
    });

    it('should omit the borrowed taxonomy for a destination that owns its taxonomy', async () => {
      const service = {
        resolveCategory: jest
          .fn()
          .mockResolvedValue({ destinationCategoryId: null, provenance: null, method: 'manual' }),
      } as unknown as ICategoryResolutionService;
      const tool = createResolveCategoryTool(service, noDestination());

      await tool.handler({ destinationConnectionId: 'dst-conn' }, CTX);

      expect(service.resolveCategory).toHaveBeenCalledWith(
        expect.not.objectContaining({ borrowedTaxonomy: expect.anything() })
      );
    });

    /**
     * 🔴 THE PROVISION-ESCALATION GUARD.
     *
     * Step 1 of the resolution chain is documented as "Provision — mirror/CREATE
     * on the destination", inert today only because
     * `CategoryResolutionService.tryProvision()` is a stub returning null. That
     * stub is the ONLY reason `resolve_category` can declare `mcp:read`.
     *
     * So this runs the REAL service, not a mock — mocking it would assert the
     * mock. When #1041 wires `CategoryProvisioner`, `tryProvision` starts
     * returning an id, this goes red, and the escalation surfaces as a build
     * failure instead of a read-scoped token silently gaining a destination
     * write.
     *
     * If this fails: DO NOT delete it and DO NOT relax it. Re-evaluate
     * `resolve_category`'s `requiredScope` — forcing that decision is the
     * entire purpose of this test.
     */
    it('should never resolve via provision while the tool declares a read scope', async () => {
      const integrations = {
        // No adapter resolves — isolates the chain from the barcode step, so a
        // 'provision' outcome could only come from step 1.
        getCapabilityAdapter: jest.fn().mockRejectedValue(new Error('no adapter')),
      } as unknown as IIntegrationsService;
      const mappingConfig = {
        resolveDestinationCategory: jest.fn().mockResolvedValue(null),
        getCategoryMappings: jest.fn().mockResolvedValue([]),
      } as unknown as IMappingConfigService;
      const realService = new CategoryResolutionService(integrations, mappingConfig);
      const tool = createResolveCategoryTool(realService, noDestination());

      const result = parse(
        await tool.handler(
          { destinationConnectionId: 'dst-conn', barcode: '5901234123457' },
          CTX
        )
      ) as { method: string };

      expect(tool.requiredScope).toBe('mcp:read');
      expect(result.method).not.toBe('provision');
    });
  });

  describe('project_attributes', () => {
    it('should surface the actionable unmapped/unresolved outputs', async () => {
      const service = {
        project: jest.fn().mockResolvedValue({
          parameters: [{ id: '1', values: ['Czerwony'], section: 'offer' }],
          unmappedSourceKeys: ['Fit'],
          unresolvedRequired: [{ id: '9', name: 'Brand', section: 'product' }], restrictionIssues: [],
        }),
      } as unknown as IAttributeProjectionService;
      const tool = createProjectAttributesTool(service, noDestination());

      const result = parse(
        await tool.handler(
          {
            destinationConnectionId: 'dst-conn',
            sourceConnectionId: 'src-conn',
            destinationCategoryId: '77',
            attributes: { Color: 'Red' },
          },
          CTX
        )
      ) as Record<string, unknown>;

      expect(result.unmappedSourceKeys).toEqual(['Fit']);
      expect(result.unresolvedRequired).toEqual([{ id: '9', name: 'Brand', section: 'product' }]);
    });

    /**
     * A shop serves its category schema under `ProductPublisher` and does NOT
     * support `OfferManager` — resolving the default would throw
     * `CapabilityNotSupportedException`, breaking this tool for every shop
     * connection (the reason `ProductPublishBuilderService` hardcodes it).
     */
    it('should project a shop destination under ProductPublisher, not OfferManager', async () => {
      const service = {
        project: jest
          .fn()
          .mockResolvedValue({ parameters: [], unmappedSourceKeys: [], unresolvedRequired: [] }),
      } as unknown as IAttributeProjectionService;
      const tool = createProjectAttributesTool(service, shopDestination());

      await tool.handler(
        {
          destinationConnectionId: 'shop-conn',
          sourceConnectionId: 'src-conn',
          destinationCategoryId: '77',
          attributes: {},
        },
        CTX
      );

      expect(service.project).toHaveBeenCalledWith(
        expect.objectContaining({ destinationCapability: 'ProductPublisher' })
      );
    });

    it('should project a marketplace destination under OfferManager with its borrowed taxonomy', async () => {
      const service = {
        project: jest
          .fn()
          .mockResolvedValue({ parameters: [], unmappedSourceKeys: [], unresolvedRequired: [] }),
      } as unknown as IAttributeProjectionService;
      const tool = createProjectAttributesTool(service, borrowingDestination('allegro'));

      await tool.handler(
        {
          destinationConnectionId: 'erli-conn',
          sourceConnectionId: 'src-conn',
          destinationCategoryId: '77',
          attributes: {},
        },
        CTX
      );

      expect(service.project).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationCapability: 'OfferManager',
          borrowedTaxonomy: 'allegro',
        })
      );
    });
  });

  describe('upsert_category_mapping', () => {
    it('should require the write scope and the admin role', () => {
      const tool = createUpsertCategoryMappingTool({} as IMappingConfigService);

      expect(tool.requiredScope).toBe('mcp:write');
      expect(tool.requiresAdmin).toBe(true);
    });

    /**
     * `CategoryMappingInput.sourceConnectionId` is optional in core (a #1036
     * record-only gap), but `upsertMapping` matches on it with `IsNull()`
     * semantics — so an omitted value inserts a SECOND row rather than updating
     * the operator's, while `findBySourceCategory` (oldest-wins) keeps
     * resolving to the original. The write would report success and change
     * nothing. The schema must therefore reject the omission.
     */
    it('should reject a call that omits sourceConnectionId', () => {
      const tool = createUpsertCategoryMappingTool({} as IMappingConfigService);

      const parsed = tool.inputSchema['~standard'].validate({
        destinationConnectionId: 'dst-conn',
        sourceCategoryId: '42',
        destinationCategoryId: '77',
        destinationCategoryName: 'Shoes',
      }) as { issues?: readonly unknown[] };

      expect(parsed.issues).toBeDefined();
      expect(parsed.issues?.length).toBeGreaterThan(0);
    });

    it('should forward a neutral CategoryMappingInput carrying the source connection', async () => {
      const saved = new CategoryMapping(
        'cm-1',
        'src-conn',
        'dst-conn',
        '42',
        '77',
        'Shoes',
        null,
        'allegro'
      );
      const service = {
        upsertCategoryMapping: jest.fn().mockResolvedValue(saved),
      } as unknown as IMappingConfigService;
      const tool = createUpsertCategoryMappingTool(service);

      await tool.handler(
        {
          destinationConnectionId: 'dst-conn',
          sourceConnectionId: 'src-conn',
          sourceCategoryId: '42',
          destinationCategoryId: '77',
          destinationCategoryName: 'Shoes',
        },
        CTX
      );

      expect(service.upsertCategoryMapping).toHaveBeenCalledWith('dst-conn', {
        sourceCategoryId: '42',
        destinationCategoryId: '77',
        destinationCategoryName: 'Shoes',
        destinationCategoryPath: undefined,
        sourceConnectionId: 'src-conn',
      });
    });
  });
});
