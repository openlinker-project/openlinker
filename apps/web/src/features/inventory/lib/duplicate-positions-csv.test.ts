/**
 * duplicate-positions-csv tests (#3264 review)
 *
 * Covers the builder's actual content — quoting, formula-injection
 * neutralisation scoped to string cells only, and one row per
 * `inventory_items` row — since nothing else in the tree inspects the CSV
 * this module builds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDuplicatePositionsCsv,
  triggerDuplicatePositionsCsvDownload,
} from './duplicate-positions-csv';
import type { DuplicatePositionGroup } from '../api/inventory.types';

function buildGroup(overrides: Partial<DuplicatePositionGroup> = {}): DuplicatePositionGroup {
  return {
    productId: 'ol_product_a1',
    productVariantId: null,
    locationId: null,
    sourceConnectionId: null,
    rowCount: 1,
    liveRowCount: 1,
    productName: null,
    sku: null,
    connectionName: null,
    locationName: null,
    rows: [],
    ...overrides,
  };
}

describe('buildDuplicatePositionsCsv', () => {
  it('should emit the header row followed by one line per inventory_items row', () => {
    const csv = buildDuplicatePositionsCsv([
      buildGroup({
        productId: 'ol_product_a1',
        rowCount: 2,
        liveRowCount: 1,
        rows: [
          {
            id: 'ol_inventory_row1',
            availableQuantity: 5,
            reservedQuantity: 1,
            isStale: false,
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
          {
            id: 'ol_inventory_row2',
            availableQuantity: 3,
            reservedQuantity: 0,
            isStale: true,
            updatedAt: '2026-09-13T00:00:00.000Z',
          },
        ],
      }),
    ]);

    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toBe(
      [
        'productId',
        'productName',
        'sku',
        'productVariantId',
        'locationId',
        'locationName',
        'sourceConnectionId',
        'connectionName',
        'groupRowCount',
        'groupLiveRowCount',
        'inventoryItemId',
        'availableQuantity',
        'reservedQuantity',
        'isStale',
        'updatedAt',
      ].join(',')
    );
    expect(lines[1]).toBe(
      'ol_product_a1,,,,,,,,2,1,ol_inventory_row1,5,1,false,2026-09-14T00:00:00.000Z'
    );
    expect(lines[2]).toBe(
      'ol_product_a1,,,,,,,,2,1,ol_inventory_row2,3,0,true,2026-09-13T00:00:00.000Z'
    );
  });

  it('should emit no rows for a group with an empty rows array', () => {
    const csv = buildDuplicatePositionsCsv([buildGroup({ rows: [] })]);
    expect(csv.split('\n')).toHaveLength(1); // header only
  });

  it('should quote a cell containing a comma, quote, or newline', () => {
    const csv = buildDuplicatePositionsCsv([
      buildGroup({
        productName: 'Widget, "Deluxe"',
        rows: [
          {
            id: 'ol_inventory_row1',
            availableQuantity: 1,
            reservedQuantity: 0,
            isStale: false,
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
        ],
      }),
    ]);

    expect(csv).toContain('"Widget, ""Deluxe"""');
  });

  it('should quote a cell containing a bare CR (#3264 review)', () => {
    const csv = buildDuplicatePositionsCsv([
      buildGroup({
        productName: 'Widget\rDeluxe',
        rows: [
          {
            id: 'ol_inventory_row1',
            availableQuantity: 1,
            reservedQuantity: 0,
            isStale: false,
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
        ],
      }),
    ]);

    expect(csv).toContain('"Widget\rDeluxe"');
  });

  it('should prefix a formula-triggering STRING cell with a single quote', () => {
    const csv = buildDuplicatePositionsCsv([
      buildGroup({
        productName: '=SUM(A1:A9)',
        sku: '+1',
        connectionName: '-cmd',
        locationName: '@evil',
        rows: [
          {
            id: 'ol_inventory_row1',
            availableQuantity: 1,
            reservedQuantity: 0,
            isStale: false,
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
        ],
      }),
    ]);

    const dataLine = csv.split('\n')[1];
    expect(dataLine).toContain("'=SUM(A1:A9)");
    expect(dataLine).toContain("'+1");
    expect(dataLine).toContain("'-cmd");
    expect(dataLine).toContain("'@evil");
  });

  it('should NOT prefix a negative numeric cell with a single quote (#3264 review)', () => {
    const csv = buildDuplicatePositionsCsv([
      buildGroup({
        rows: [
          {
            id: 'ol_inventory_row1',
            availableQuantity: -3,
            reservedQuantity: -1,
            isStale: false,
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
        ],
      }),
    ]);

    const dataLine = csv.split('\n')[1];
    const cells = dataLine.split(',');
    // availableQuantity / reservedQuantity are the 12th and 13th columns
    // (index 11/12: productId, productName, sku, productVariantId,
    // locationId, locationName, sourceConnectionId, connectionName,
    // groupRowCount, groupLiveRowCount, inventoryItemId, then these two).
    expect(cells[11]).toBe('-3');
    expect(cells[12]).toBe('-1');
    expect(dataLine).not.toContain("'-3");
    expect(dataLine).not.toContain("'-1");
  });

  it('should render null fields as empty cells', () => {
    const csv = buildDuplicatePositionsCsv([
      buildGroup({
        productName: null,
        sku: null,
        locationId: null,
        locationName: null,
        sourceConnectionId: null,
        connectionName: null,
        rows: [
          {
            id: 'ol_inventory_row1',
            availableQuantity: 1,
            reservedQuantity: 0,
            isStale: false,
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
        ],
      }),
    ]);

    const dataLine = csv.split('\n')[1];
    expect(dataLine).toBe(
      'ol_product_a1,,,,,,,,1,1,ol_inventory_row1,1,0,false,2026-09-14T00:00:00.000Z'
    );
  });
});

describe('triggerDuplicatePositionsCsvDownload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should prepend a UTF-8 BOM so Excel does not mojibake a non-ASCII productName (#3264 review)', async () => {
    let blob: Blob | undefined;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((b: Blob) => {
        blob = b;
        return 'blob:mock';
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    triggerDuplicatePositionsCsvDownload('header\nvalue', 'test.csv');

    expect(blob).toBeDefined();
    const text = await blob!.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toBe('﻿header\nvalue');
  });
});
