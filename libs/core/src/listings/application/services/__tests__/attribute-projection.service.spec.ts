/**
 * Unit tests for AttributeProjectionService (#1038).
 */
import { AttributeProjectionService } from '../attribute-projection.service';
import { AttributeMapping, AttributeValueMapping } from '@openlinker/core/mappings';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { CategoryParameter } from '@openlinker/core/listings';

const SRC = 'conn-source';
const DEST = 'conn-dest';
const CAT = 'cat-123';

function mapping(
  sourceAttributeKey: string,
  destinationParameterName: string,
  opts: {
    destinationCategoryId?: string | null;
    sourceConnectionId?: string;
    values?: { sourceValue: string; destinationValue: string }[];
    id?: string;
  } = {}
): AttributeMapping {
  const id = opts.id ?? `m-${sourceAttributeKey}-${opts.destinationCategoryId ?? 'null'}`;
  return new AttributeMapping(
    id,
    opts.sourceConnectionId ?? SRC,
    DEST,
    sourceAttributeKey,
    destinationParameterName,
    opts.destinationCategoryId ?? null,
    (opts.values ?? []).map((v, i) => new AttributeValueMapping(`${id}-v${i}`, id, v.sourceValue, v.destinationValue))
  );
}

function param(partial: Partial<CategoryParameter> & { id: string; name: string }): CategoryParameter {
  return {
    type: 'string',
    required: false,
    restrictions: {},
    section: 'offer',
    ...partial,
  };
}

describe('AttributeProjectionService', () => {
  let service: AttributeProjectionService;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let mappingConfig: jest.Mocked<Pick<IMappingConfigService, 'getAttributeMappings'>>;

  const ownsAdapter = (params: CategoryParameter[]): unknown => ({
    updateOfferQuantity: jest.fn(),
    fetchCategoryParameters: jest.fn().mockResolvedValue(params),
  });
  const passthroughAdapter = (): unknown => ({ updateOfferQuantity: jest.fn() });

  function build(
    adapter: unknown,
    mappings: AttributeMapping[]
  ): AttributeProjectionService {
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
    } as jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
    mappingConfig = {
      getAttributeMappings: jest.fn().mockResolvedValue(mappings),
    } as jest.Mocked<Pick<IMappingConfigService, 'getAttributeMappings'>>;
    return new AttributeProjectionService(
      integrations as unknown as IIntegrationsService,
      mappingConfig as unknown as IMappingConfigService
    );
  }

  const input = (attributes: Record<string, string>) => ({
    sourceConnectionId: SRC,
    destinationConnectionId: DEST,
    destinationCategoryId: CAT,
    attributes,
  });

  it('resolves a dictionary parameter to its entry id (owns)', async () => {
    const params = [
      param({
        id: 'p-color',
        name: 'Kolor',
        type: 'dictionary',
        required: true,
        dictionary: [
          { id: 'd-red', value: 'Czerwony' },
          { id: 'd-blue', value: 'Niebieski' },
        ],
      }),
    ];
    service = build(ownsAdapter(params), [
      mapping('Color', 'Kolor', { values: [{ sourceValue: 'Red', destinationValue: 'Czerwony' }] }),
    ]);

    const result = await service.project(input({ Color: 'Red' }));

    expect(result.parameters).toEqual([
      { id: 'p-color', valuesIds: ['d-red'], section: 'offer' },
    ]);
    expect(result.unresolvedRequired).toEqual([]);
    expect(result.unmappedSourceKeys).toEqual([]);
  });

  it('emits free-text values for a non-dictionary parameter (owns)', async () => {
    const params = [param({ id: 'p-mat', name: 'Material', type: 'string' })];
    service = build(ownsAdapter(params), [mapping('Fabric', 'Material')]);

    const result = await service.project(input({ Fabric: 'Cotton' }));

    expect(result.parameters).toEqual([{ id: 'p-mat', values: ['Cotton'], section: 'offer' }]);
  });

  it('surfaces a required parameter with no mapping as unresolvedRequired', async () => {
    const params = [param({ id: 'p-brand', name: 'Marka', required: true })];
    service = build(ownsAdapter(params), []);

    const result = await service.project(input({ Color: 'Red' }));

    expect(result.unresolvedRequired).toEqual([{ id: 'p-brand', name: 'Marka' }]);
    expect(result.parameters).toEqual([]);
  });

  it('surfaces a required dictionary param whose value is not in the dictionary', async () => {
    const params = [
      param({
        id: 'p-color',
        name: 'Kolor',
        type: 'dictionary',
        required: true,
        dictionary: [{ id: 'd-red', value: 'Czerwony' }],
      }),
    ];
    service = build(ownsAdapter(params), [mapping('Color', 'Kolor')]); // no value translation

    const result = await service.project(input({ Color: 'Magenta' }));

    expect(result.parameters).toEqual([]);
    expect(result.unresolvedRequired).toEqual([{ id: 'p-color', name: 'Kolor' }]);
  });

  it('passes through name-keyed parameters when the destination does not own its taxonomy', async () => {
    service = build(passthroughAdapter(), [
      mapping('Color', 'colour', { values: [{ sourceValue: 'Red', destinationValue: 'red' }] }),
    ]);

    const result = await service.project(input({ Color: 'Red' }));

    expect(result.parameters).toEqual([{ id: 'colour', values: ['red'], section: 'offer' }]);
  });

  it('reports present-but-unmapped source attributes', async () => {
    const params = [param({ id: 'p-mat', name: 'Material' })];
    service = build(ownsAdapter(params), [mapping('Fabric', 'Material')]);

    const result = await service.project(input({ Fabric: 'Cotton', Color: 'Red' }));

    expect(result.unmappedSourceKeys).toEqual(['Color']);
  });

  it('prefers a category-specific mapping over the connection-wide default', async () => {
    const params = [param({ id: 'p-mat', name: 'Material' })];
    service = build(ownsAdapter(params), [
      mapping('Fabric', 'Material', { destinationCategoryId: null, values: [{ sourceValue: 'C', destinationValue: 'default' }] }),
      mapping('Fabric', 'Material', { destinationCategoryId: CAT, values: [{ sourceValue: 'C', destinationValue: 'specific' }] }),
    ]);

    const result = await service.project(input({ Fabric: 'C' }));

    expect(result.parameters).toEqual([{ id: 'p-mat', values: ['specific'], section: 'offer' }]);
  });

  it('ignores mappings belonging to a different source connection', async () => {
    const params = [param({ id: 'p-mat', name: 'Material' })];
    service = build(ownsAdapter(params), [
      mapping('Fabric', 'Material', { sourceConnectionId: 'other-source' }),
    ]);

    const result = await service.project(input({ Fabric: 'Cotton' }));

    expect(result.parameters).toEqual([]);
    expect(result.unmappedSourceKeys).toEqual(['Fabric']);
  });
});
