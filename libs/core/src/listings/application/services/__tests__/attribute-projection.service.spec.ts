/**
 * Unit tests for AttributeProjectionService (#1038).
 */
import { AttributeProjectionService } from '../attribute-projection.service';
import { AttributeMapping, AttributeValueMapping, AttributeMappingRule } from '@openlinker/core/mappings';
import type { IMappingConfigService, AttributeMappingRuleConfig } from '@openlinker/core/mappings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { CategoryParameter, AttributeProjectionMetadata } from '@openlinker/core/listings';

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
    mappings: AttributeMapping[],
    rules: AttributeMappingRule[] = []
  ): AttributeProjectionService {
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
    } as jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
    mappingConfig = {
      getAttributeMappings: jest.fn().mockResolvedValue(mappings),
      getAttributeMappingRules: jest.fn().mockResolvedValue(rules),
    } as jest.Mocked<Pick<IMappingConfigService, 'getAttributeMappings' | 'getAttributeMappingRules'>>;
    return new AttributeProjectionService(
      integrations as unknown as IIntegrationsService,
      mappingConfig as unknown as IMappingConfigService
    );
  }

  function rule(
    destinationParameterName: string,
    config: AttributeMappingRuleConfig,
    opts: {
      priority?: number;
      id?: string;
      sourceConnectionId?: string | null;
      destinationCategoryId?: string | null;
      manufacturerMatch?: string | null;
      phraseMatch?: string | null;
    } = {}
  ): AttributeMappingRule {
    return new AttributeMappingRule(
      opts.id ?? `r-${destinationParameterName}-${opts.priority ?? 0}`,
      DEST,
      destinationParameterName,
      config,
      opts.priority ?? 0,
      opts.sourceConnectionId ?? null,
      opts.destinationCategoryId ?? null,
      opts.manufacturerMatch ?? null,
      opts.phraseMatch ?? null
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

    expect(result.unresolvedRequired).toEqual([
      { id: 'p-brand', name: 'Marka', section: 'offer' },
    ]);
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
    expect(result.unresolvedRequired).toEqual([
      { id: 'p-color', name: 'Kolor', section: 'offer' },
    ]);
  });

  it('passes through name-keyed parameters when the destination does not own its taxonomy', async () => {
    service = build(passthroughAdapter(), [
      mapping('Color', 'colour', { values: [{ sourceValue: 'Red', destinationValue: 'red' }] }),
    ]);

    const result = await service.project(input({ Color: 'Red' }));

    expect(result.parameters).toEqual([{ id: 'colour', values: ['red'], section: 'offer' }]);
  });

  it('reuses owner attribute mappings by provenance for a borrows destination (#1045)', async () => {
    // ERLI (borrows): zero attribute rows authored against the ERLI destination,
    // but the operator's Allegro-authored rows are reused by provenance.
    const integrationsMock = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(passthroughAdapter()),
    } as unknown as IIntegrationsService;
    const getAttributeMappingsByProvenance = jest
      .fn()
      .mockResolvedValue([
        mapping('Color', 'colour', { values: [{ sourceValue: 'Red', destinationValue: 'red' }] }),
      ]);
    const mappingConfigMock = {
      getAttributeMappings: jest.fn().mockResolvedValue([]),
      getAttributeMappingsByProvenance,
      getAttributeMappingRules: jest.fn().mockResolvedValue([]),
    } as unknown as IMappingConfigService;
    const svc = new AttributeProjectionService(integrationsMock, mappingConfigMock);

    const result = await svc.project({ ...input({ Color: 'Red' }), borrowedTaxonomy: 'allegro' });

    expect(getAttributeMappingsByProvenance).toHaveBeenCalledWith('allegro');
    expect(result.parameters).toEqual([{ id: 'colour', values: ['red'], section: 'offer' }]);
  });

  it('does not consult provenance mappings when borrowedTaxonomy is absent (#1045)', async () => {
    const integrationsMock = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(passthroughAdapter()),
    } as unknown as IIntegrationsService;
    const getAttributeMappingsByProvenance = jest.fn().mockResolvedValue([]);
    const mappingConfigMock = {
      getAttributeMappings: jest.fn().mockResolvedValue([mapping('Color', 'colour')]),
      getAttributeMappingsByProvenance,
      getAttributeMappingRules: jest.fn().mockResolvedValue([]),
    } as unknown as IMappingConfigService;
    const svc = new AttributeProjectionService(integrationsMock, mappingConfigMock);

    await svc.project(input({ Color: 'Red' }));

    expect(getAttributeMappingsByProvenance).not.toHaveBeenCalled();
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

  describe('operator attribute mapping rules (#1841)', () => {
    const inputWith = (
      attributes: Record<string, string>,
      metadata?: AttributeProjectionMetadata
    ) => ({ ...input(attributes), ...(metadata ? { metadata } : {}) });

    it('applies a fixed-value rule (owns dictionary param)', async () => {
      const params = [
        param({
          id: 'p-brand',
          name: 'Marka',
          type: 'dictionary',
          required: true,
          dictionary: [{ id: 'd-acme', value: 'ACME' }],
        }),
      ];
      service = build(ownsAdapter(params), [], [rule('Marka', { kind: 'fixed', value: 'ACME' })]);

      const result = await service.project(input({}));

      expect(result.parameters).toEqual([{ id: 'p-brand', valuesIds: ['d-acme'], section: 'offer' }]);
      expect(result.unresolvedRequired).toEqual([]);
    });

    it('applies a fixed-value rule on the borrows/pass-through path', async () => {
      service = build(passthroughAdapter(), [], [rule('Brand', { kind: 'fixed', value: 'ACME' })]);

      const result = await service.project(input({}));

      expect(result.parameters).toEqual([{ id: 'Brand', values: ['ACME'], section: 'offer' }]);
    });

    it('applies a copy-remap rule (36S -> 36) and marks the source key used', async () => {
      const params = [param({ id: 'p-size', name: 'Rozmiar' })];
      service = build(
        ownsAdapter(params),
        [],
        [
          rule('Rozmiar', {
            kind: 'copy-remap',
            sourceAttributeKey: 'Size',
            valueRemap: [{ sourceValue: '36S', destinationValue: '36' }],
          }),
        ]
      );

      const result = await service.project(input({ Size: '36S' }));

      expect(result.parameters).toEqual([{ id: 'p-size', values: ['36'], section: 'offer' }]);
      expect(result.unmappedSourceKeys).toEqual([]);
    });

    it('copy-remap passes the source value through when no remap entry matches', async () => {
      service = build(
        passthroughAdapter(),
        [],
        [rule('Rozmiar', { kind: 'copy-remap', sourceAttributeKey: 'Size', valueRemap: [] })]
      );

      const result = await service.project(input({ Size: '42' }));

      expect(result.parameters).toEqual([{ id: 'Rozmiar', values: ['42'], section: 'offer' }]);
    });

    it('skips a copy-remap rule whose source attribute is absent', async () => {
      const params = [param({ id: 'p-size', name: 'Rozmiar' })];
      service = build(
        ownsAdapter(params),
        [],
        [rule('Rozmiar', { kind: 'copy-remap', sourceAttributeKey: 'Size', valueRemap: [] })]
      );

      const result = await service.project(input({}));

      expect(result.parameters).toEqual([]);
    });

    it.each([
      ['name', { productName: 'Widget Pro' }, 'Widget Pro'],
      ['variant', { variantName: 'Red / M' }, 'Red / M'],
      ['manufacturer', { manufacturer: 'ACME' }, 'ACME'],
      ['ean', { ean: '5901234123457' }, '5901234123457'],
      ['sku', { sku: 'SKU-1' }, 'SKU-1'],
      ['weight', { weight: '1.5' }, '1.5'],
    ] as const)('fills a place-value rule from metadata.%s', async (source, metadata, expected) => {
      service = build(
        passthroughAdapter(),
        [],
        [rule('Field', { kind: 'place-value', source })]
      );

      const result = await service.project(inputWith({}, metadata));

      expect(result.parameters).toEqual([{ id: 'Field', values: [expected], section: 'offer' }]);
    });

    it('skips a place-value rule when the metadata field is missing', async () => {
      service = build(passthroughAdapter(), [], [rule('Field', { kind: 'place-value', source: 'sku' })]);

      const result = await service.project(input({}));

      expect(result.parameters).toEqual([]);
    });

    it('applies rules in priority order, later rule wins for the same parameter', async () => {
      service = build(
        passthroughAdapter(),
        [],
        [
          rule('Brand', { kind: 'fixed', value: 'first' }, { priority: 10, id: 'r-a' }),
          rule('Brand', { kind: 'fixed', value: 'second' }, { priority: 20, id: 'r-b' }),
        ]
      );

      const result = await service.project(input({}));

      expect(result.parameters).toEqual([{ id: 'Brand', values: ['second'], section: 'offer' }]);
    });

    it('a rule wins over a legacy attribute mapping for the same destination parameter', async () => {
      const params = [param({ id: 'p-mat', name: 'Material' })];
      service = build(
        ownsAdapter(params),
        [mapping('Fabric', 'Material', { values: [{ sourceValue: 'C', destinationValue: 'from-mapping' }] })],
        [rule('Material', { kind: 'fixed', value: 'from-rule' })]
      );

      const result = await service.project(input({ Fabric: 'C' }));

      expect(result.parameters).toEqual([{ id: 'p-mat', values: ['from-rule'], section: 'offer' }]);
    });

    it('filters a rule out by destination category scope', async () => {
      service = build(
        passthroughAdapter(),
        [],
        [rule('Brand', { kind: 'fixed', value: 'X' }, { destinationCategoryId: 'other-cat' })]
      );

      const result = await service.project(input({}));

      expect(result.parameters).toEqual([]);
    });

    it('filters a rule by manufacturer scope (case-insensitive)', async () => {
      service = build(
        passthroughAdapter(),
        [],
        [
          rule('Brand', { kind: 'fixed', value: 'match' }, { manufacturerMatch: 'acme' }),
          rule('Other', { kind: 'fixed', value: 'nomatch' }, { manufacturerMatch: 'nike' }),
        ]
      );

      const result = await service.project(inputWith({}, { manufacturer: 'ACME' }));

      expect(result.parameters).toEqual([{ id: 'Brand', values: ['match'], section: 'offer' }]);
    });

    it('filters a rule by product-name phrase scope (substring, case-insensitive)', async () => {
      service = build(
        passthroughAdapter(),
        [],
        [
          rule('Brand', { kind: 'fixed', value: 'match' }, { phraseMatch: 'pro' }),
          rule('Other', { kind: 'fixed', value: 'nomatch' }, { phraseMatch: 'lite' }),
        ]
      );

      const result = await service.project(inputWith({}, { productName: 'Widget PRO Max' }));

      expect(result.parameters).toEqual([{ id: 'Brand', values: ['match'], section: 'offer' }]);
    });

    it('honours source-connection scope on a rule', async () => {
      service = build(
        passthroughAdapter(),
        [],
        [rule('Brand', { kind: 'fixed', value: 'X' }, { sourceConnectionId: 'other-source' })]
      );

      const result = await service.project(input({}));

      expect(result.parameters).toEqual([]);
    });
  });

  describe('restriction reporting (#2243)', () => {
    it('reports a mapped value that breaks a declared bound, and still emits it', async () => {
      // The operator never sees this value - it comes from a mapping rule - so
      // this is the only place it can be checked before Allegro answers.
      const params = [
        param({ id: '250792', name: 'Kod taryfy celnej', restrictions: { minLength: 8 } }),
      ];
      service = build(ownsAdapter(params), [mapping('CN', 'Kod taryfy celnej')]);

      const result = await service.project(input({ CN: '250792' }));

      expect(result.parameters).toEqual([
        { id: '250792', values: ['250792'], section: 'offer' },
      ]);
      expect(result.restrictionIssues).toHaveLength(1);
      expect(result.restrictionIssues[0]).toMatchObject({
        code: 'VALUE_TOO_SHORT',
        severity: 'block',
        parameterId: '250792',
        parameterName: 'Kod taryfy celnej',
      });
    });

    it('reports nothing when the mapped value is inside the declared bound', async () => {
      const params = [
        param({ id: '250792', name: 'Kod taryfy celnej', restrictions: { minLength: 8 } }),
      ];
      service = build(ownsAdapter(params), [mapping('CN', 'Kod taryfy celnej')]);

      const result = await service.project(input({ CN: '25079200' }));

      expect(result.restrictionIssues).toEqual([]);
    });

    it('reports a dictionary miss instead of dropping the parameter silently', async () => {
      const params = [
        param({
          id: 'p-color',
          name: 'Kolor',
          type: 'dictionary',
          dictionary: [{ id: 'd-beige', value: 'Beżowy' }],
        }),
      ];
      service = build(ownsAdapter(params), [mapping('Color', 'Kolor')]);

      const result = await service.project(input({ Color: 'Cappuccino' }));

      // Still dropped - an unknown id is its own rejection - but no longer only
      // a debug line: an offer published WITHOUT the value looks fine and is not.
      expect(result.parameters).toEqual([]);
      expect(result.restrictionIssues).toHaveLength(1);
      expect(result.restrictionIssues[0]).toMatchObject({
        code: 'VALUE_NOT_IN_DICTIONARY',
        parameterName: 'Kolor',
      });
      expect(result.restrictionIssues[0].message).toContain('Cappuccino');
    });

    it('does NOT claim a dictionary miss on a parameter that accepts custom values', async () => {
      // The parameter is still dropped (`toResolvedParameter` returns null for
      // any dictionary non-match, pre-existing), but Allegro would have accepted
      // this value - so reporting it as VALUE_NOT_IN_DICTIONARY would upgrade a
      // silent drop into a positive false claim. The miss goes through the same
      // checker as every other value, which is what keeps the guard in one place.
      const params = [
        param({
          id: 'p-color',
          name: 'Kolor',
          type: 'dictionary',
          dictionary: [{ id: 'd-beige', value: 'Beżowy' }],
          restrictions: { customValuesEnabled: true },
        }),
      ];
      service = build(ownsAdapter(params), [mapping('Color', 'Kolor')]);

      const result = await service.project(input({ Color: 'Cappuccino' }));

      expect(result.parameters).toEqual([]);
      expect(result.restrictionIssues).toEqual([]);
    });

    it('does NOT claim a dictionary miss when the destination enumerated no entries', async () => {
      // A dictionary the destination did not enumerate cannot be checked against.
      const params = [param({ id: 'p-color', name: 'Kolor', type: 'dictionary', dictionary: [] })];
      service = build(ownsAdapter(params), [mapping('Color', 'Kolor')]);

      const result = await service.project(input({ Color: 'Cappuccino' }));

      expect(result.restrictionIssues).toEqual([]);
    });

    it('reports nothing on the pass-through branch, which has no schema to check against', async () => {
      service = build(passthroughAdapter(), [mapping('CN', 'Kod taryfy celnej')]);

      const result = await service.project(input({ CN: '250792' }));

      expect(result.parameters).toHaveLength(1);
      expect(result.restrictionIssues).toEqual([]);
    });
  });
});
