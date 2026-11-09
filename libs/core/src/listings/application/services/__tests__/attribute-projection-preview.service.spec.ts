/**
 * Unit tests for AttributeProjectionPreviewService (#3995).
 *
 * The property under test is that the preview feeds the projection exactly what
 * a publish feeds it, so the wizard's "this is what Allegro receives" holds.
 */
import { AttributeProjectionPreviewService } from '../attribute-projection-preview.service';
import { buildProjectionMetadata } from '../build-projection-metadata';
import { MasterCatalogConnectionNotConfiguredException } from '../../../domain/exceptions/master-catalog-connection-not-configured.exception';
import type { IAttributeProjectionService } from '../../interfaces/attribute-projection.service.interface';
import type {
  AttributeProjectionInput,
  AttributeProjectionResult,
} from '../../types/attribute-projection.types';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';

const DEST = 'conn-allegro';
const MASTER = 'conn-shop';

const product = {
  id: 'prod-1',
  name: 'Koszulka Basic',
  features: [{ name: 'Marka', value: 'Basic Wear' }],
} as unknown as Product;

function variant(id: string, attributes: Record<string, string>, ean: string | null = null): ProductVariant {
  return { id, productId: 'prod-1', sku: `SKU-${id}`, ean, gtin: null, attributes } as unknown as ProductVariant;
}

const emptyProjection: AttributeProjectionResult = {
  parameters: [],
  unmappedSourceKeys: [],
  unresolvedRequired: [],
  restrictionIssues: [],
  origins: [],
};

describe('AttributeProjectionPreviewService', () => {
  let products: { getVariant: jest.Mock };
  let connections: { get: jest.Mock };
  let productMaster: { getProduct: jest.Mock };
  let destination: Record<string, unknown>;
  let integrations: { getCapabilityAdapter: jest.Mock };
  let projection: { project: jest.Mock<Promise<AttributeProjectionResult>, [AttributeProjectionInput]> };
  let service: AttributeProjectionPreviewService;

  beforeEach(() => {
    const variants: Record<string, ProductVariant> = {
      v1: variant('v1', { Size: 'S', Color: 'Black' }, '5901234123457'),
      v2: variant('v2', { Size: 'M', Color: 'White' }),
    };
    products = { getVariant: jest.fn((id: string) => Promise.resolve(variants[id] ?? null)) };
    connections = {
      get: jest.fn().mockResolvedValue({ id: DEST, config: { masterCatalogConnectionId: MASTER } }),
    };
    productMaster = { getProduct: jest.fn().mockResolvedValue(product) };
    destination = { updateOfferQuantity: jest.fn() };
    integrations = {
      getCapabilityAdapter: jest.fn((connectionId: string) =>
        Promise.resolve(connectionId === MASTER ? productMaster : destination)
      ),
    };
    projection = {
      project: jest
        .fn<Promise<AttributeProjectionResult>, [AttributeProjectionInput]>()
        .mockResolvedValue(emptyProjection),
    };
    service = new AttributeProjectionPreviewService(
      products as unknown as IProductsService,
      connections as unknown as ConnectionPort,
      integrations as unknown as IIntegrationsService,
      projection as unknown as IAttributeProjectionService
    );
  });

  it('should project with the same inputs a publish uses', async () => {
    await service.preview({
      connectionId: DEST,
      items: [{ internalVariantId: 'v1', categoryId: 'cat-1' }],
    });

    expect(projection.project).toHaveBeenCalledWith({
      sourceConnectionId: MASTER,
      destinationConnectionId: DEST,
      destinationCategoryId: 'cat-1',
      attributes: { Size: 'S', Color: 'Black' },
      metadata: buildProjectionMetadata(
        product,
        variant('v1', { Size: 'S', Color: 'Black' }, '5901234123457'),
        '5901234123457'
      ),
    });
  });

  it('should let the operator EAN override win in the metadata, as at publish', async () => {
    await service.preview({
      connectionId: DEST,
      items: [{ internalVariantId: 'v1', categoryId: 'cat-1', ean: '4006381333931' }],
    });

    expect(projection.project.mock.calls[0][0].metadata?.ean).toBe('4006381333931');
  });

  it('should thread the borrowed taxonomy of a borrowing destination', async () => {
    destination.getBorrowedTaxonomy = jest.fn().mockReturnValue('allegro');

    await service.preview({
      connectionId: DEST,
      items: [{ internalVariantId: 'v1', categoryId: 'cat-1' }],
    });

    expect(projection.project.mock.calls[0][0].borrowedTaxonomy).toBe('allegro');
  });

  it('should read the master product once for siblings of one product', async () => {
    await service.preview({
      connectionId: DEST,
      items: [
        { internalVariantId: 'v1', categoryId: 'cat-1' },
        { internalVariantId: 'v2', categoryId: 'cat-1' },
      ],
    });

    expect(productMaster.getProduct).toHaveBeenCalledTimes(1);
    expect(projection.project).toHaveBeenCalledTimes(2);
  });

  it('should report a missing variant on its own entry and keep previewing the rest', async () => {
    const result = await service.preview({
      connectionId: DEST,
      items: [
        { internalVariantId: 'gone', categoryId: 'cat-1' },
        { internalVariantId: 'v2', categoryId: 'cat-1' },
      ],
    });

    expect(result.entries).toEqual([
      { internalVariantId: 'gone', categoryId: 'cat-1', status: 'failed', reason: 'variant-not-found' },
      expect.objectContaining({ internalVariantId: 'v2', status: 'ok' }),
    ]);
  });

  it('should report a failed projection as a failure, never as an empty result', async () => {
    projection.project.mockRejectedValueOnce(new Error('schema read timed out'));

    const result = await service.preview({
      connectionId: DEST,
      items: [{ internalVariantId: 'v1', categoryId: 'cat-1' }],
    });

    expect(result.entries).toEqual([
      { internalVariantId: 'v1', categoryId: 'cat-1', status: 'failed', reason: 'projection-failed' },
    ]);
  });

  it('should throw when the connection has no master catalogue', async () => {
    connections.get.mockResolvedValue({ id: DEST, config: {} });

    await expect(
      service.preview({ connectionId: DEST, items: [{ internalVariantId: 'v1', categoryId: 'cat-1' }] })
    ).rejects.toBeInstanceOf(MasterCatalogConnectionNotConfiguredException);
  });

  it('should return no entries and touch nothing for an empty batch', async () => {
    const result = await service.preview({ connectionId: DEST, items: [] });

    expect(result.entries).toEqual([]);
    expect(connections.get).not.toHaveBeenCalled();
  });
});
